import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

// Exercise the real route/client/cache code with isolated auth, pricing, and
// supplier boundaries. Never read .env or contact a live supplier/database.
const root = fileURLToPath(new URL("../", import.meta.url));
const state = globalThis.__searchPerformanceTest = { after: [], records: [], authCalls: 0, errors: 0 };
const mocks = {
  "next/server": `export { NextRequest, NextResponse } from 'next/server.js'; export const after = cb => globalThis.__searchPerformanceTest.after.push(cb);`,
  "@/lib/auth": `export const auth = { api: { getSession: async ({headers}) => { globalThis.__searchPerformanceTest.authCalls++; return { user: { id: headers.get('x-test-user') } }; } } }; export const toAppSession = async s => s;`,
  "@/lib/user-data": `export const recordUserSearch = async data => { globalThis.__searchPerformanceTest.records.push(data); };`,
  "@/lib/pricing": `export const getAoryxHotelB2BPlatformFee = async () => 0.2; export const getAoryxHotelPlatformFee = async () => 0.1;`,
  "@/lib/aoryx-error-log": `export const logAoryxEndpointError = async () => { globalThis.__searchPerformanceTest.errors++; };`,
  "@/lib/aoryx-flow-logger": `export const logAoryxFlow = () => {};`,
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier in mocks) return { url: `search-test:${specifier}`, shortCircuit: true };
    if (specifier.startsWith("@/")) return next(pathToFileURL(`${root}${specifier.slice(2)}.ts`).href, context);
    if (specifier.startsWith(".") && context.parentURL?.startsWith(pathToFileURL(root).href)) {
      const url = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(url))) return next(url.href, context);
    }
    return next(specifier, context.parentURL?.startsWith("search-test:") ? { ...context, parentURL: import.meta.url } : context);
  },
  load(url, context, next) {
    if (url.startsWith("search-test:")) return { format: "module", shortCircuit: true, source: mocks[url.slice(12)] };
    if (url.startsWith(pathToFileURL(root).href) && url.endsWith(".ts")) return {
      format: "module", shortCircuit: true,
      source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText,
    };
    return next(url, context);
  },
});
Object.assign(process.env, {
  AORYX_ENV: "live", AORYX_BASE_URL: "https://supplier.invalid", AORYX_API_KEY: "fixture-only",
  AORYX_RATE_TOKEN_SECRET: "fixture-only-secret", AORYX_ALL_ENDPOINT_FLOW_LOGS: "false",
});
const { createAsyncTtlCache } = await import("../lib/async-ttl-cache.ts");
const { POST: resultsSearch } = await import("../app/api/aoryx/results-search/route.ts");
const { POST: legacySearch } = await import("../app/api/aoryx/search/route.ts");
const { POST: countryInfo } = await import("../app/api/aoryx/country-info/route.ts");
const { POST: destinationHotels } = await import("../app/api/aoryx/hotels-by-destination/route.ts");
const { loadSearchHotels, loadSearchDestinations } = await import("../lib/search-catalog-client.ts");
const { fetchResultsSearch } = await import("../lib/results-search-client.ts");
const { hotelsInfoByDestinationId } = await import("../lib/aoryx-client.ts");
const { buildSearchQuery } = await import("../lib/search-query.ts");
const { decodeSearchToken, hashSearchRooms } = await import("../lib/aoryx-rate-tokens.ts");
const params = { destinationCode: "160-0", countryCode: "AE", nationality: "AM", currency: "USD", checkInDate: "2026-10-01", checkOutDate: "2026-10-04", rooms: [{ roomIdentifier: 1, adults: 2, childrenAges: [7] }] };
const supplierResult = { IsSuccess: true, GeneralInfo: { SessionId: "fixture-session" }, Monetary: { Currency: { Code: "USD" } }, Hotels: { Hotel: [{ Code: "H1", MinPrice: 100, HotelInfo: { Name: "Fixture Hotel", StarRating: "5" } }] }, Audit: { PropertyCount: 1 } };
const request = (body, signal) => new Request("https://megatours.invalid/api/search", { method: "POST", headers: { "Content-Type": "application/json", "x-test-user": "fixture-user" }, body: JSON.stringify(body), signal });

test("catalog cache coalesces loads, expires, bounds storage, and retries failures", async () => {
  let now = 0;
  let calls = 0;
  const cache = createAsyncTtlCache(10, 2, () => now);
  const load = async () => ++calls;
  assert.deepEqual(await Promise.all(Array.from({ length: 20 }, () => cache.get("a", load))), Array(20).fill(1));
  now = 11;
  assert.equal(await cache.get("a", load), 2);
  await cache.get("b", load);
  await cache.get("c", load);
  assert.equal(await cache.get("a", load), 5);
  await assert.rejects(cache.get("bad", async () => { throw Error("temporary"); }));
  assert.equal(await cache.get("bad", async () => "recovered"), "recovered");
});

test("results route preserves pricing/token context and defers auth/history", async (t) => {
  const previous = globalThis.fetch;
  t.after(() => { globalThis.fetch = previous; });
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://supplier.invalid/AvailabilityDetail");
    const sent = JSON.parse(init.body);
    assert.equal(sent.SearchParameter.Nationality, "AM");
    return Response.json(supplierResult);
  };
  const response = await resultsSearch(request({ query: buildSearchQuery(params) }));
  assert.equal(response.status, 200, await response.clone().text());
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.match(response.headers.get("server-timing"), /supplier_search;dur=/);
  assert.match(response.headers.get("server-timing"), /pricing;dur=/);
  const result = await response.json();
  assert.equal(result.data.hotels[0].minPrice, 110.00000000000001);
  assert.equal(result.data.sessionId, undefined);
  assert.equal(state.authCalls, 0);
  assert.equal(state.records.length, 0);
  assert.ok(result.data.searchToken.startsWith("mt_as_"));
  const token = decodeSearchToken(result.data.searchToken);
  assert.equal(token.sessionId, "fixture-session");
  assert.equal(token.roomsHash, hashSearchRooms(params.rooms));
  assert.equal(token.checkInDate, params.checkInDate);
  assert.equal(token.nationality, params.nationality);
  await state.after.shift()();
  assert.equal(state.records[0].params.rooms[0].childrenAges[0], 7);
  assert.equal(state.records[0].userId, "fixture-user");
  const legacy = await legacySearch(request(params));
  assert.equal((await legacy.json()).hotels[0].minPrice, 110.00000000000001);
  assert.equal(state.records.length, 1, "legacy history is also deferred");
  await state.after.shift()();
});

test("replaced search aborts supplier work without retries or timeout logging", async (t) => {
  const previous = globalThis.fetch;
  t.after(() => { globalThis.fetch = previous; });
  let supplierCalls = 0;
  let aborted = false;
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  globalThis.fetch = async (_url, { signal }) => {
    supplierCalls++;
    started();
    return new Promise((_, reject) => signal.addEventListener("abort", () => {
      aborted = true;
      reject(signal.reason);
    }, { once: true }));
  };
  const before = state.errors;
  const controller = new AbortController();
  const response = resultsSearch(request({ query: buildSearchQuery(params) }, controller.signal));
  await ready;
  controller.abort();
  assert.equal((await response).status, 499);
  assert.equal(aborted, true);
  assert.equal(supplierCalls, 1);
  assert.equal(state.errors, before);
  assert.equal(state.after.length, 0);
});

test("static country and hotel cache misses share one supplier request", async (t) => {
  const previous = globalThis.fetch;
  t.after(() => { globalThis.fetch = previous; });
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls++;
    assert.ok(String(url).startsWith("https://supplier.invalid/"));
    if (String(url).endsWith("country-info")) return Response.json({ isSuccess: true, data: [{ key: "160-0", value: "Dubai" }] });
    return Response.json({ IsSuccess: true, HotelsInformation: [{ SystemId: "H1", Name: "Fixture Hotel" }] });
  };
  const responses = await Promise.all(Array.from({ length: 10 }, () => countryInfo(request({ countryCode: "AE" }))));
  assert.equal(calls, 1);
  assert.equal((await responses[0].json()).destinations[0].id, "160");
  const catalogs = await Promise.all(Array.from({ length: 10 }, () => hotelsInfoByDestinationId("160-0")));
  assert.equal(calls, 2);
  assert.equal(catalogs[0][0].systemId, "H1");
});

test("malformed results queries return 400 without supplier calls", async (t) => {
  const previous = globalThis.fetch;
  t.after(() => { globalThis.fetch = previous; });
  globalThis.fetch = async () => { throw Error("Supplier must not be called"); };
  for (const body of [null, {}, { query: "" }, { query: "x".repeat(8001) }, { query: `${buildSearchQuery(params)}&rooms=null` }]) {
    // URLSearchParams takes the first repeated value; replace for the invalid-room case.
    if (body?.query?.endsWith("&rooms=null")) { const q = new URLSearchParams(body.query); q.set("rooms", "null"); body.query = q.toString(); }
    assert.equal((await resultsSearch(request(body))).status, 400);
  }
});

test("browser catalogs reuse requests across mounts and retry failed loads", async (t) => {
  const previous = globalThis.fetch;
  t.after(() => { globalThis.fetch = previous; });
  let calls = 0;
  let fail = true;
  globalThis.fetch = async (url) => {
    assert.ok(String(url).startsWith("/api/aoryx/"));
    calls++;
    if (fail) return Response.json({ error: "Temporarily unavailable" }, { status: 503 });
    return Response.json({ hotels: [{ systemId: "H1" }], destinations: [{ id: "160", name: "Dubai" }] });
  };
  const failed = await Promise.allSettled(Array.from({ length: 5 }, () => loadSearchHotels("client-fixture", "160")));
  assert.ok(failed.every(result => result.status === "rejected"));
  assert.equal(calls, 1);
  fail = false;
  await Promise.all(Array.from({ length: 5 }, () => loadSearchHotels("client-fixture", "160")));
  await loadSearchHotels("client-fixture", "160");
  assert.equal(calls, 2);
  await Promise.all([loadSearchDestinations(), loadSearchDestinations()]);
  await loadSearchDestinations();
  assert.equal(calls, 3);
});

test("complete catalog failure remains retryable instead of caching empty success", async (t) => {
  const previous = globalThis.fetch;
  const previousError = console.error;
  t.after(() => { globalThis.fetch = previous; console.error = previousError; });
  console.error = () => {};
  let fail = true;
  globalThis.fetch = async (url) => {
    assert.equal(String(url), "https://supplier.invalid/HotelsInfoByDestinationId");
    return Response.json(fail
      ? { IsSuccess: false, ExceptionMessage: "Temporary catalog failure" }
      : { IsSuccess: true, HotelsInformation: [{ SystemId: "recovered" }] });
  };
  assert.equal((await destinationHotels(request({ destinationId: "retry-0" }))).status, 500);
  fail = false;
  const recovered = await destinationHotels(request({ destinationId: "retry-0" }));
  assert.equal(recovered.status, 200);
  assert.equal((await recovered.json()).hotels[0].systemId, "recovered");
});

test("browser search helper forwards cancellation and preserves error responses", async (t) => {
  const previous = globalThis.fetch;
  t.after(() => { globalThis.fetch = previous; });
  const controller = new AbortController();
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "/api/aoryx/results-search");
    assert.equal(init.signal, controller.signal);
    assert.equal(init.cache, "no-store");
    return Response.json({ ok: false, code: "MISSING_SESSION_ID", error: "" }, { status: 502 });
  };
  assert.equal((await fetchResultsSearch(buildSearchQuery(params), controller.signal)).code, "MISSING_SESSION_ID");
});
