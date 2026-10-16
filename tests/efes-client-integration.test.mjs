import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const entries = new Map();
const matches = (entry, filter) => Object.entries(filter).every(([key, value]) =>
  value && typeof value === "object" && "$in" in value ? value.$in.includes(entry[key]) : entry[key] === value);
const collection = {
  async insertOne(entry) {
    if (entries.has(entry._id)) throw Object.assign(new Error("duplicate key"), { code: 11000 });
    entries.set(entry._id, structuredClone(entry));
  },
  async findOne(filter) { return structuredClone([...entries.values()].find(entry => matches(entry, filter)) ?? null); },
  async findOneAndUpdate(filter, update) {
    const entry = [...entries.values()].find(entry => matches(entry, filter));
    if (!entry) return null;
    Object.assign(entry, structuredClone(update.$set));
    return structuredClone(entry);
  },
  async updateOne(filter, update) { await this.findOneAndUpdate(filter, update); },
  find(filter) { return { toArray: async () => structuredClone([...entries.values()].filter(entry => matches(entry, filter))) }; },
};
globalThis.__efesTestDb = { collection: () => collection };
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@/lib/db") return { url: "efes-test:db", shortCircuit: true };
    return next(specifier.startsWith("@/") ? pathToFileURL(`${root}${specifier.slice(2)}.ts`).href : specifier, context);
  },
  load(url, context, next) {
    if (url === "efes-test:db") return { format: "module", shortCircuit: true, source: "export const getDb = async () => globalThis.__efesTestDb;" };
    if (url.startsWith(pathToFileURL(root).href) && url.endsWith(".ts")) {
      return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText };
    }
    return next(url, context);
  },
});
Object.assign(process.env, { EFES_ENV: "prod", EFES_BASE_URL_PROD: "https://efes.invalid", EFES_USER: "test-user", EFES_PASSWORD: "test-password", EFES_COMPANY_ID: "test-company", EFES_POLICY_TIMEOUT_MS: "60000" });
const { createEfesPoliciesFromBooking, EfesPolicyIssuanceError } = await import("../lib/efes-client.ts");
const { refreshEfesPolicyResults } = await import("../lib/efes-policy-store.ts");
const { resolveInsuranceIssuance } = await import("../lib/insurance-policy-status.ts");

test("real EFES client retains slow results, deduplicates, and refreshes pending bookings", async () => {
  const info = console.info;
  const error = console.error;
  const fetch = globalThis.fetch;
  const logs = [];
  console.info = (...args) => logs.push(args);
  console.error = (...args) => logs.push(args);
  let policyCalls = 0;
  let quoteCalls = 0;
  let mode = "slow";
  let expectedCountry = null;
  const payload = {
    customerRefNumber: "test-booking", sessionId: "test-session", rooms: [],
    insurance: { provider: "efes", price: 8400, startDate: "2026-09-13", endDate: "2026-09-19", territoryCode: "world", riskAmount: 15000, riskCurrency: "EUR", travelers:
      [0, 1, 2, 3].map(index => ({ id: `traveler-${index}`, firstName: "Անի", lastName: "Պետրոսյան", firstNameEn: "Ani", lastNameEn: "Petrosyan", birthDate: index === 1 ? "1960-01-01" : "1996-01-01", passportNumber: `TEST${index}`, premium: 2100 })) },
  };
  globalThis.fetch = async (url, options) => {
    assert.ok(String(url).startsWith("https://efes.invalid/"), "No live EFES calls are allowed");
    if (String(url).endsWith("/auth")) return Response.json({ jwt: "test-jwt" });
    if (String(url).endsWith("/script")) {
      quoteCalls++;
      const body = JSON.parse(options.body);
      return Response.json({
        is_error: 0,
        error_code: 0,
        result: { SUM: Number(body.dyn_object.age) >= 65 ? 4200 : 2100 },
      });
    }
    policyCalls++;
    const body = JSON.parse(options.body);
    if (expectedCountry) assert.equal(body.TRAVEL_COUNTRIES, expectedCountry);
    const index = Number(body.TRAVEL_PASSPORT_NUMBER.slice(-1));
    assert.equal(body.RISK_UNIVERSAL_PREMIUM, index === 1 ? "4200" : "2100");
    assert.equal(body.INSURED_NAME, "Անի");
    assert.equal(body.INSURED_NAME_EN, "Ani");
    if (mode === "mixed" && index === 0) throw new Error("socket reset");
    if (mode === "mixed" && index === 1) return Response.json({ is_error: 1, error_code: 4, error_msg: "Validation error - 0094" });
    // Reproduce the production failure: one policy arrives after the old 15s limit.
    const delay = mode === "slow" && index === 3 ? 15100 : 5;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, delay);
      options.signal.addEventListener("abort", () => { clearTimeout(timer); reject(options.signal.reason); }, { once: true });
    });
    return Response.json({ is_error: 0, error_code: 0, result: `RT-TEST-${index}` });
  };
  try {
    const results = await createEfesPoliciesFromBooking(payload);
    assert.equal(results.length, 4);
    assert.equal(payload.insurance.price, 10500);
    assert.equal(payload.insurance.travelers[1].premium, 4200);
    assert.equal(policyCalls, 4);
    assert.equal(quoteCalls, 4);
    assert.equal([...entries.values()].filter(entry => entry.state === "confirmed").length, 4);
    const replay = await createEfesPoliciesFromBooking(payload);
    assert.equal(policyCalls, 4);
    assert.deepEqual(replay, results);
    const stale = { insurancePolicies: results.map(result => ({ ...result, response: null, confirmationStatus: "pending" })), insuranceError: "EFES request failed" };
    await refreshEfesPolicyResults(stale);
    assert.equal(resolveInsuranceIssuance({ insuranceSelected: true, ...stale }).status, "confirmed");

    mode = "cyprus"; expectedCountry = "Cyprus";
    const cyprus = { ...payload, countryCode: "CY", customerRefNumber: "cyprus-test", insurance: { ...payload.insurance, travelCountries: "Կիպրոս" } };
    const cyprusPolicies = await createEfesPoliciesFromBooking(cyprus);
    assert.equal(cyprusPolicies.length, 4);
    expectedCountry = null;
    mode = "mixed";
    const nextPayload = { ...payload, customerRefNumber: "test-booking-2" };
    let mixed;
    await assert.rejects(createEfesPoliciesFromBooking(nextPayload), err => {
      assert.ok(err instanceof EfesPolicyIssuanceError);
      mixed = err.policyResults;
      return /pending/.test(err.message);
    });
    assert.equal(mixed[0].confirmationStatus, "pending");
    assert.equal(mixed[1].response.error_code, 4);
    assert.equal(mixed[2].response.result, "RT-TEST-2");
    assert.equal(mixed[3].response.result, "RT-TEST-3");
    const beforeReplay = policyCalls;
    await assert.rejects(createEfesPoliciesFromBooking(nextPayload));
    assert.equal(policyCalls, beforeReplay);
    // A changed request is only allowed to retry the explicitly rejected traveler.
    mode = "corrected";
    const corrected = structuredClone(nextPayload);
    corrected.insurance.travelers[1].lastName = "Սարգսյան";
    await assert.rejects(createEfesPoliciesFromBooking(corrected));
    assert.equal(policyCalls, beforeReplay + 1);
    const record = { insurancePolicies: mixed };
    await refreshEfesPolicyResults(record);
    assert.equal(record.insurancePolicies[1].response.result, "RT-TEST-1");
    assert.equal(record.insurancePolicies[0].confirmationStatus, "pending");
    assert.ok(logs.some(args => String(args[0]).includes('"timeoutMs":60000')));
  } finally {
    console.info = info;
    console.error = error;
    globalThis.fetch = fetch;
  }
});
