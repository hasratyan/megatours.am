import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "b2c-test:server-only", shortCircuit: true };
    if (specifier === "next/server") return next("next/server.js", context);
    if (specifier.startsWith("@/")) return next(pathToFileURL(`${root}${specifier.slice(2)}.ts`).href, context);
    if (specifier.startsWith(".") && context.parentURL?.startsWith(pathToFileURL(root).href) && !context.parentURL.includes("/node_modules/") && !/\.(ts|mjs|js)$/.test(specifier)) {
      const target = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(target))) return next(target.href, context);
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === "b2c-test:server-only") return { format: "module", source: "", shortCircuit: true };
    if (url.startsWith(pathToFileURL(root).href) && url.endsWith(".ts")) return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText };
    return next(url, context);
  },
});
const { NextRequest } = await import("next/server.js");
const { POST: search } = await import("../app/api/destinations/[destination]/hotels/search/route.ts");
const { POST: prebook } = await import("../app/api/destinations/[destination]/hotels/prebook/route.ts");
const { destinationSearchSession } = await import("../lib/packages/search-session.ts");
const { destinationServiceProxy } = await import("../lib/packages/service-proxy.ts");
const request = (payload, headers = {}) => new NextRequest("https://b2c.invalid/api/destinations/cyprus/hotels/search", { method: "POST", headers: { "content-type": "application/json", host: "b2c.invalid", origin: "https://b2c.invalid", ...headers }, body: JSON.stringify(payload) });
const params = { params: Promise.resolve({ destination: "cyprus" }) };

test("public search replaces client identity and cannot override pricing/market", async (t) => {
  const previous = globalThis.fetch;
  t.after(() => { globalThis.fetch = previous; });
  process.env.B2C_AGENT_URL = "https://agent.invalid";
  process.env.B2C_AGENT_SERVICES_TOKEN = "fixture-service-token";
  const cookie = "00000000-0000-0000-0000-000000000001";
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://agent.invalid/api/b2c/v1/hotels/search");
    assert.equal(init.redirect, "error");
    assert.equal(init.headers.authorization, "Bearer fixture-service-token");
    const body = JSON.parse(init.body);
    assert.equal(body.destinationId, "cyprus");
    assert.equal(body.ownerId, destinationSearchSession(request({}, { cookie: `megatours-destination-session=${cookie}` })).ownerId);
    assert.equal(body.markup, undefined);
    assert.equal(body.marketCode, undefined);
    assert.equal(body.mode, undefined);
    return Response.json({ offers: [], partial: false, nextOffset: null });
  };
  const response = await search(request({ cityId: "city", mode: "hotel_only", rooms: [], ownerId: "attacker", destinationId: "uae", markup: 0, marketCode: "another" }, { cookie: `megatours-destination-session=${cookie}` }), params);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie"), /HttpOnly/);
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.deepEqual(await response.json(), { offers: [], partial: false, nextOffset: null });
});
test("off-origin mutations and invalid selections are rejected without calling agent", async (t) => {
  const previous = globalThis.fetch;
  t.after(() => { globalThis.fetch = previous; });
  globalThis.fetch = () => { throw new Error("Must not call agent"); };
  assert.equal((await search(request({}, { origin: "https://untrusted.invalid" }), params)).status, 403);
  assert.equal((await search(request({}, { origin: "http://b2c.invalid" }), params)).status, 403);
  assert.equal((await search(request({}, { "sec-fetch-site": "cross-site" }), params)).status, 403);
  assert.equal((await prebook(request({ offerId: "fake", mode: "hotel_only" }), params)).status, 400);
  assert.equal((await search(request({}), { params: Promise.resolve({ destination: "uae" }) })).status, 404);
});
test("supplier failures expose only a safe code and fresh owner cookie", async (t) => {
  const previous = globalThis.fetch;
  t.after(() => { globalThis.fetch = previous; });
  globalThis.fetch = async () => Response.json({ error: "Secret provider auth failed. API key=private" }, { status: 500 });
  const response = await prebook(request({ offerId: "00000000-0000-0000-0000-000000000001", mode: "hotel_transfer", ownerId: "attacker" }), params);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { code: "unavailable" });
  assert.match(response.headers.get("set-cookie"), /HttpOnly/);
});

test("package routes whitelist identifiers and selections; client prices and ownership are ignored", async (t) => {
  const previous = globalThis.fetch; t.after(() => { globalThis.fetch = previous; });
  const hotelOfferId = "00000000-0000-0000-0000-000000000001";
  globalThis.fetch = async (url, init) => {
    assert.match(String(url), /\/api\/b2c\/v1\/packages\/review$/);
    const body = JSON.parse(init.body);
    assert.equal(body.hotelOfferId, hotelOfferId); assert.deepEqual(body.selectedServices, ["transfer", "flight"]); assert.deepEqual(body.serviceOfferIds, [hotelOfferId, "00000000-0000-0000-0000-000000000002"]);
    assert.match(body.ownerId, /^visitor:[a-f0-9]{64}$/);
    assert.equal(body.price, undefined); assert.equal(body.markup, undefined); assert.equal(body.paymentEnabled, undefined);
    assert.equal(body.paymentPlan, undefined);
    return Response.json({ paymentEnabled: false });
  };
  const response = await destinationServiceProxy(request({ hotelOfferId, selectedServices: ["transfer", "flight"], serviceOfferIds: [hotelOfferId, "00000000-0000-0000-0000-000000000002"], ownerId: "attacker", markup: 0, price: 1, paymentEnabled: true, paymentPlan: { checkout: { provider: "megatours", totals: [{ amount: 1, currency: "EUR" }] } } }), params.params, "packages/review");
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { paymentEnabled: false });
  assert.equal((await destinationServiceProxy(request({ hotelOfferId }, { origin: "https://attacker.invalid" }), params.params, "services/search")).status, 403);
});

test("automatic attraction searches cannot select a supplier, country, price or owner", async (t) => {
  const previous = globalThis.fetch; t.after(() => { globalThis.fetch = previous; });
  const hotelOfferId = "00000000-0000-0000-0000-000000000001";
  globalThis.fetch = async (url, init) => {
    assert.match(String(url), /\/api\/b2c\/v1\/attractions\/search$/);
    const body = JSON.parse(init.body);
    assert.deepEqual(Object.keys(body).sort(), ["hotelOfferId", "ownerId"]);
    assert.equal(body.hotelOfferId, hotelOfferId); assert.match(body.ownerId, /^visitor:[a-f0-9]{64}$/);
    return Response.json({ offers: [] });
  };
  const response = await destinationServiceProxy(request({ hotelOfferId, ownerId: "attacker", countryCode: "AE", price: 1, rateKey: "private", offerId: "fake" }), params.params, "attractions/search");
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { offers: [] });
});

test("malformed service arrays and obsolete fixed-type reviews cannot silently drop extras", async (t) => {
  const previous=globalThis.fetch;t.after(()=>{globalThis.fetch=previous;});globalThis.fetch=()=>{throw new Error("Must not call agent");};
  const hotelOfferId="00000000-0000-0000-0000-000000000001";
  for(const change of [{selectedServices:["transfer","transfer"]},{selectedServices:["anything"]},{selectedServices:"flight"},{serviceOfferIds:["not-a-quote"]},{serviceOfferIds:[hotelOfferId,hotelOfferId]}]) assert.equal((await destinationServiceProxy(request({hotelOfferId,...change}),params.params,"packages/review")).status,400);
  assert.equal((await destinationServiceProxy(request({hotelOfferId,mode:"hotel_transfer",serviceOfferId:hotelOfferId}),params.params,"packages/review")).status,409);
});
test("transfer and flight searches explicitly request their service with the same validated hotel",async(t)=>{
  const previous=globalThis.fetch;t.after(()=>{globalThis.fetch=previous;});
  const hotelOfferId="00000000-0000-0000-0000-000000000001"; const seen=[];
  globalThis.fetch=async(_url,init)=>{ const body=JSON.parse(init.body);seen.push(body.service);assert.equal(body.hotelOfferId,hotelOfferId);assert.equal(body.mode,undefined);return Response.json({offers:[]});};
  for(const service of ["transfer","flight"]) assert.equal((await destinationServiceProxy(request({hotelOfferId,service,airport:"LCA",origin:"EVN"}),params.params,"services/search")).status,200);
  assert.deepEqual(seen,["transfer","flight"]);
});
