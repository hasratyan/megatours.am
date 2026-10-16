import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
const root = fileURLToPath(new URL("../", import.meta.url));
const stubs = {
  "next/server": 'export * from "next/server.js";export const after=(callback)=>globalThis.orderFixture.after.push(callback);',
  "@/lib/db": 'export const getDb=async()=>globalThis.orderFixture.db;',
  "@/lib/auth-compat/server": 'export const getServerSession=async()=>globalThis.orderFixture.session;',
  "@/lib/auth": 'export const authOptions={};',
  "@/lib/pricing": 'export const getAmdRateForCurrency=async()=>400;',
  "@/lib/payment-method-flags": 'export const getPaymentMethodFlags=async()=>({idbank_card:true,ameria_card:true,idram:true});',
  "@/lib/booking-addons": 'export const parseBookingAddonServices=()=>({});',
  "@/lib/efes-client": 'export const requoteEfesInsuranceSelection=()=>{throw Error("unexpected insurance call")};export const createEfesPoliciesFromBooking=()=>{throw Error("unexpected issuance")};',
  "@/lib/idbank-gateway-audit": 'export const postIdbankFormWithAudit=async(input)=>{if(!globalThis.orderFixture.register)throw Error("unexpected bank registration");return globalThis.orderFixture.register(input)};',
  "@/lib/vpos-payment-details": 'export const getVposPaymentDetails=async()=>({raw:globalThis.orderFixture.bank});',
};
registerHooks({ resolve(specifier, context, next) {
  if (specifier === "server-only") return { url: "order-test:empty", shortCircuit: true };
  if (stubs[specifier]) return { url: `order-test:${specifier}`, shortCircuit: true };

  if (specifier.startsWith("@/")) return next(pathToFileURL(`${root}${specifier.slice(2)}.ts`).href, context);
  if (specifier.startsWith(".") && context.parentURL?.startsWith(pathToFileURL(root).href) && !context.parentURL.includes("/node_modules/") && !/\.(ts|mjs|js)$/.test(specifier)) { const target = new URL(`${specifier}.ts`, context.parentURL); if (existsSync(fileURLToPath(target))) return next(target.href, context); }
  return next(specifier, context.parentURL?.startsWith("order-test:") ? { ...context, parentURL: import.meta.url } : context);
}, load(url, context, next) {
  if (url.startsWith("order-test:")) return { format: "module", source: stubs[url.slice(11)] || "", shortCircuit: true };
  if (url.startsWith(pathToFileURL(root).href) && url.endsWith(".ts")) return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText };
  return next(url, context);
} });
const { NextRequest } = await import("next/server.js");
const { destinationOrderRoute, hotelBankReturn, flightBankReturn } = await import("../lib/packages/orders.ts");
const { hotelGatewayPaidInFull } = await import("../lib/packages/hotel-gateway.ts");
const { seal, unseal, nonceHash, validIdramSignature, transferScheduleMatches } = await import("../lib/packages/order-security.ts");
const { createHash } = await import("node:crypto");
const id = "00000000-0000-4000-8000-000000000001";
function fixture(t) {
  Object.assign(process.env, { B2C_AGENT_URL: "https://agent-fixture.invalid", B2C_AGENT_SERVICES_TOKEN: "fixture-secret-0000000000000000000000000000", NEXT_PUBLIC_SITE_URL: "https://megatours.am" });
  const entries = new Map(), calls = [];
  const match = (row, filter) => Object.entries(filter).every(([key, value]) => typeof value === "object" && value !== null ? ("$ne" in value ? row[key] !== value.$ne : "$exists" in value ? (row[key] !== undefined) === value.$exists : "$gt" in value ? row[key] > value.$gt : false) : row[key] === value);
  const collection = { async findOne(filter) { return structuredClone([...entries.values()].find((row) => match(row, filter)) || null); }, async updateOne(filter, update, options = {}) {
    let row = [...entries.values()].find((entry) => match(entry, filter));
    if (!row && options.upsert) { row = { _id: filter._id, ...update.$setOnInsert }; entries.set(row._id, row); }
    if (!row) return { modifiedCount: 0 }; Object.assign(row, update.$set); return { modifiedCount: 1 };
  }, async findOneAndUpdate(filter, update) { const row = [...entries.values()].find((entry) => match(entry, filter)); if (!row) return null; Object.assign(row, update.$set); return structuredClone(row); } };
  globalThis.orderFixture = { db: { collection: () => collection }, session: { user: { id: "real-customer" } }, bank: {}, after: [] };
  const order = { id, hotelPaid: false, hotelStatus: "awaiting_payment", hotel: { name: "Test Hotel", checkIn: "2027-11-15", checkOut: "2027-11-17" }, contact: { email: "nobody@example.invalid" }, guests: [], flight: { status: "ready", canPay: true } };
  t.mock.method(globalThis, "fetch", async (url, init) => { assert.equal(new URL(url).origin, "https://agent-fixture.invalid"); const body = JSON.parse(init.body); calls.push({ path: new URL(url).pathname, body }); assert.equal(body.customerId, "real-customer"); return Response.json(order); });
  entries.set(id, { _id: id, customerId: "real-customer", locale: "en", amountAmd: 100000, privatePayload: seal({}), gateway: { provider: "idbank", gatewayId: "trusted-bank-id", amountAmd: 100000, decimals: 2 }, expiresAt: new Date(Date.now()+100000).toISOString() });
  return { entries, calls, order };
}
const request = (body, extra = {}) => new NextRequest("https://megatours.am/api/destinations/cyprus/orders/status", { method: "POST", headers: { origin: "https://megatours.am", "content-type": "application/json", ...extra }, body: JSON.stringify(body) });
test("order access rejects anonymous/cross-site/other-customer requests and browser confirmation endpoints", async (t) => {
  const f = fixture(t);
  assert.equal((await destinationOrderRoute(request({ orderId:id }, { origin: "https://attacker.invalid" }), "status")).status, 403);
  globalThis.orderFixture.session = null;
  assert.equal((await destinationOrderRoute(request({ orderId:id }), "status")).status, 401);
  globalThis.orderFixture.session = { user: { id: "other-customer" } };
  assert.equal((await destinationOrderRoute(request({ orderId:id, customerId:"real-customer" }), "status")).status, 404);
  globalThis.orderFixture.session = { user: { id: "real-customer" } };
  assert.equal((await destinationOrderRoute(request({ orderId:id, amountAmd:1, paymentReference:"forged" }), "hotel/confirm")).status, 404);
  assert.equal((await destinationOrderRoute(request({ orderId:id, challengeResponse:"forged" }), "flights/verify")).status, 404);
  assert.equal(f.calls.length, 0);
  assert.equal((await destinationOrderRoute(request({ orderId:id, customerId:"attacker" }), "status")).status, 200);
});
test("bank-return query parameters cannot establish hotel payment", async (t) => {
  const f = fixture(t);
  await hotelBankReturn(new NextRequest(`https://megatours.am/api/destinations/cyprus/hotel-return?order=${id}&status=success&amount=100000&orderId=forged`));
  assert.equal(f.calls.length, 0); assert.notEqual(f.entries.get(id).paid, true);
  globalThis.orderFixture.bank = { currency: "051", orderStatus:2, actionCode:0, paymentAmountInfo:{ depositedAmount:10000000 } };
  await hotelBankReturn(new NextRequest(`https://megatours.am/api/destinations/cyprus/hotel-return?order=${id}`));
  await globalThis.orderFixture.after.shift()();
  assert.equal(f.calls[0].path, "/api/b2c/v1/orders/hotel/confirm"); assert.equal(f.calls[0].body.paymentReference, "trusted-bank-id"); assert.equal(f.calls[0].body.amountAmd,100000);
});
test("flight verification nonce survives duplicate clicks and can be consumed once", async (t) => {
  const f = fixture(t);
  const response = await destinationOrderRoute(request({ orderId:id, card:{ number:"4242424242424242", security:"123" }, feeQuoteId:"fee", responseUrl:"https://attacker.invalid", customerId:"attacker" }), "flights/pay"); assert.equal(response.status,202);
  await globalThis.orderFixture.after.shift()();
  const callback = new URL(f.calls.find((call)=>call.path.endsWith("flights/pay")).body.responseUrl), token = callback.searchParams.get("token"); assert.equal(callback.origin,"https://megatours.am");
  const firstHash=f.entries.get(id).callbackHash;
  assert.equal((await destinationOrderRoute(request({ orderId:id, card:{} }), "flights/pay")).status,409); assert.equal(f.entries.get(id).callbackHash,firstHash);
  assert.equal(firstHash,nonceHash(token)); assert.doesNotMatch(JSON.stringify(f.entries.get(id)), /4242424242424242|"security"/);
  const form=new URLSearchParams({ PaRes:"fixture-verification" });
  assert.equal((await flightBankReturn(new NextRequest(callback,{method:"POST",body:form}))).status,303);
  await globalThis.orderFixture.after.shift()();
  await flightBankReturn(new NextRequest(callback,{method:"POST",body:form}));
  assert.equal(f.calls.filter((call)=>call.path.endsWith("flights/verify")).length,1);
});
test("payment confirmation requires captured funds, exact amount and AMD currency", () => {
  const valid={currency:"051",orderStatus:2,actionCode:0,paymentAmountInfo:{depositedAmount:10000}};
  assert.equal(hotelGatewayPaidInFull("idbank",valid,100,2),true);
  for (const changed of [{...valid,orderStatus:1},{...valid,currency:"840"},{...valid,paymentAmountInfo:{depositedAmount:9999}},{...valid,actionCode:5}]) assert.equal(hotelGatewayPaidInFull("idbank",changed,100,2),false);
  assert.equal(hotelGatewayPaidInFull("ameriabank",{Currency:"AMD",ResponseCode:"00",OrderStatus:2,Amount:100},100,2),true);
  assert.equal(hotelGatewayPaidInFull("ameriabank",{Currency:"AMD",ResponseCode:"00",OrderStatus:1,Amount:100},100,2),false);
});
test("private order payload is authenticated and wallet callbacks require the exact signed amount",()=>{
  process.env.B2C_AGENT_SERVICES_TOKEN="fixture-secret-0000000000000000000000000000";
  const encrypted=seal({passport:"PRIVATE"}); assert.doesNotMatch(encrypted,/PRIVATE/); assert.deepEqual(unseal(encrypted),{passport:"PRIVATE"});
  const tampered=Buffer.from(encrypted,"base64url");tampered[30]^=1;assert.throws(()=>unseal(tampered.toString("base64url")));
  const fields={EDP_REC_ACCOUNT:"fixture",EDP_AMOUNT:"100.00",EDP_BILL_NO:`CY-${id}`,EDP_PAYER_ACCOUNT:"payer",EDP_TRANS_ID:"transaction",EDP_TRANS_DATE:"date"};
  fields.EDP_CHECKSUM=createHash("md5").update([fields.EDP_REC_ACCOUNT,fields.EDP_AMOUNT,"secret",fields.EDP_BILL_NO,fields.EDP_PAYER_ACCOUNT,fields.EDP_TRANS_ID,fields.EDP_TRANS_DATE].join(":" )).digest("hex");
  assert.equal(validIdramSignature(fields,"secret"),true);assert.equal(validIdramSignature({...fields,EDP_AMOUNT:"1.00"},"secret"),false);
});

test("transfer pickup dates and local times must match the server-validated quote", () => {
  const journeys=[{departure:"2026-11-15T12:00:00"},{departure:"2026-11-17T09:00:00"}];
  const accepted={arrivalDateTime:"2026-11-15T12:00",departureDateTime:"2026-11-17T09:00"};
  assert.equal(transferScheduleMatches(journeys,accepted),true);
  assert.equal(transferScheduleMatches(journeys,{...accepted,arrivalDateTime:"2026-11-15T14:00"}),false);
  assert.equal(transferScheduleMatches(journeys,{...accepted,departureDateTime:"2026-11-18T09:00"}),false);
  assert.equal(transferScheduleMatches(journeys,{}),false);
});

test("Cyprus payment stays disabled until launch, and a test bank endpoint cannot take live bookings", async () => {
  const { hotelGatewayConfigured } = await import("../lib/packages/hotel-gateway.ts");
  const values = { B2C_CYPRUS_CHECKOUT_ENABLED: "true", IDRAM_REC_ACCOUNT: "fixture", IDRAM_SECRET_KEY: "fixture", NODE_ENV: "production", AMERIA_VPOS_BASE_URL: "https://servicestest.ameriabank.am", AMERIA_VPOS_CLIENT_ID: "fixture", AMERIA_VPOS_USERNAME: "fixture", AMERIA_VPOS_PASSWORD: "fixture" };
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  try {
    assert.equal(hotelGatewayConfigured("idram"), true);
    assert.equal(hotelGatewayConfigured("ameriabank"), false);
    delete process.env.B2C_CYPRUS_CHECKOUT_ENABLED;
    assert.equal(hotelGatewayConfigured("idram"), false);
  } finally { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});

test("wallet payment forms use the bank's Armenian language code without contacting the wallet", async () => {
  const { initializeHotelGateway } = await import("../lib/packages/hotel-gateway.ts");
  const previous = { account: process.env.IDRAM_REC_ACCOUNT, secret: process.env.IDRAM_SECRET_KEY };
  process.env.IDRAM_REC_ACCOUNT = "fixture"; process.env.IDRAM_SECRET_KEY = "fixture";
  try {
    const intent = await initializeHotelGateway({ provider: "idram", orderId: id, amountAmd: 100, locale: "hy", email: "nobody@example.invalid", returnUrl: "https://megatours.am" });
    assert.equal(intent.fields.EDP_LANGUAGE, "AM"); assert.equal(intent.fields.EDP_AMOUNT, "100.00"); assert.equal(intent.fields.EDP_BILL_NO, `CY-${id}`);
  } finally { if (previous.account === undefined) delete process.env.IDRAM_REC_ACCOUNT; else process.env.IDRAM_REC_ACCOUNT = previous.account; if (previous.secret === undefined) delete process.env.IDRAM_SECRET_KEY; else process.env.IDRAM_SECRET_KEY = previous.secret; }
});

test("card registration uses a bounded merchant reference and the server-locked AMD amount", async () => {
  const { initializeHotelGateway } = await import("../lib/packages/hotel-gateway.ts");
  const values = { VPOS_BASE_URL: "https://bank-fixture.invalid/payment/rest", VPOS_USER: "fixture", VPOS_PASSWORD: "fixture", VPOS_CURRENCY_CODE: "051", VPOS_CURRENCY_DECIMALS: "2" };
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]])); Object.assign(process.env, values);
  globalThis.orderFixture.register = async (request) => {
    const body = new URLSearchParams(request.body); assert.ok(body.get("orderNumber").length <= 32); assert.equal(body.get("amount"), "12480700"); assert.equal(body.get("currency"), "051");
    return { response: { ok: true }, parsedBody: { errorCode: "0", orderId: "fixture-bank", formUrl: "https://epg.arca.am/payment/fixture-bank" } };
  };
  try {
    const intent = await initializeHotelGateway({ provider: "idbank", orderId: id, amountAmd: 124807, locale: "en", email: "nobody@example.invalid", returnUrl: "https://megatours.am" });
    assert.equal(intent.gatewayId, "fixture-bank"); assert.ok(intent.merchantOrder.startsWith("CY-"));
  } finally { delete globalThis.orderFixture.register; for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});

test("bank payment pages may use the confirmed bank gateway origin, but never arbitrary redirects", async () => {
  const { allowedIdbankFormUrl } = await import("../lib/packages/hotel-gateway.ts");
  const base = "https://ipayproxy.idp.am/payment/rest";
  assert.equal(allowedIdbankFormUrl("https://epg.arca.am/payment/fixture", base), true);
  assert.equal(allowedIdbankFormUrl("https://ipayproxy.idp.am/payment/fixture", base), true);
  assert.equal(allowedIdbankFormUrl("https://attacker.invalid/payment", base), false);
  assert.equal(allowedIdbankFormUrl("http://epg.arca.am/payment", base), false);
  assert.equal(allowedIdbankFormUrl("https://epg.arca.am@attacker.invalid/payment", base), false);
});
