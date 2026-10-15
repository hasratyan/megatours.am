import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const mocks = {
  "@/lib/pricing": "export const getAoryxHotelPlatformFee = async () => 0.2;",
  "@/lib/aoryx-error-log": "export const logAoryxEndpointError = async () => {};",
  "@/lib/aoryx-flow-logger": "export const logAoryxFlow = () => {};",
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier in mocks) return { url: `area-test:${specifier}`, shortCircuit: true };
    if (specifier.startsWith("@/")) return next(pathToFileURL(`${root}${specifier.slice(2)}.ts`).href, context);
    if (specifier.startsWith(".") && context.parentURL?.startsWith(pathToFileURL(root).href)) {
      const url = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(url))) return next(url.href, context);
    }
    return next(specifier, context.parentURL?.startsWith("area-test:") ? { ...context, parentURL: import.meta.url } : context);
  },
  load(url, context, next) {
    if (url.startsWith("area-test:")) return { format: "module", shortCircuit: true, source: mocks[url.slice(10)] };
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

const { getAreaLocationOptions } = await import("../lib/search-locations.ts");
const { buildSearchQuery, parseSearchParams } = await import("../lib/search-query.ts");
const { isHotelInAoryxArea } = await import("../lib/aoryx-area-filter.ts");
const { isHotelInArea } = await import("../lib/hotel-area-geometry.ts");
const { runAoryxSearch } = await import("../lib/aoryx-search.ts");
const params = {
  destinationCode: "160-0", countryCode: "AE", nationality: "AM", currency: "USD",
  checkInDate: "2026-11-15", checkOutDate: "2026-11-17",
  rooms: [{ roomIdentifier: 1, adults: 2, childrenAges: [] }],
};

test("area sub-items retain the parent city and survive query reloads", () => {
  const dubai = getAreaLocationOptions({ type: "destination", value: "160", rawId: "160-0", label: "Dubai" });
  const abuDhabi = getAreaLocationOptions({ type: "destination", value: "604", rawId: "604-0", label: "Abu Dhabi" });
  assert.equal(dubai.length, 7);
  assert.equal(abuDhabi.length, 5);
  assert.ok(dubai.every((option) => option.parentDestinationId === "160-0"));
  assert.ok(abuDhabi.every((option) => option.parentDestinationId === "604-0"));
  assert.equal(dubai.find((option) => option.areaId === "palm-jumeirah").label, "Palm Jumeirah, Dubai");
  assert.equal(abuDhabi.find((option) => option.areaId === "saadiyat-island").label, "Saadiyat Island, Abu Dhabi");
  assert.deepEqual(getAreaLocationOptions({ type: "destination", value: "605-0", label: "Sharjah" }), []);

  const query = buildSearchQuery({ ...params, areaId: "palm-jumeirah", meals: ["BB"] });
  const reloaded = parseSearchParams(new URLSearchParams(query)).payload;
  assert.equal(reloaded.destinationCode, "160-0");
  assert.equal(reloaded.areaId, "palm-jumeirah");
  assert.deepEqual(reloaded.meals, ["BB"]);
  for (const changes of [{ destinationCode: "604-0" }, { hotelCode: "H1" }, { areaId: "unknown-area" }]) {
    const next = parseSearchParams(new URLSearchParams(buildSearchQuery({ ...reloaded, ...changes }))).payload;
    assert.equal(next.areaId, undefined, "switching city or hotel clears the previous area");
  }
  const mismatched = new URLSearchParams(query);
  mismatched.set("destinationCode", "604-0");
  assert.equal(parseSearchParams(mismatched).payload.areaId, undefined);
});

test("mapped boundaries include Marina/JBR and islands but exclude outsiders and missing coordinates", () => {
  assert.equal(isHotelInAoryxArea(25.089, 55.148, "dubai-marina"), true);
  assert.equal(isHotelInAoryxArea(25.078, 55.132, "dubai-marina"), true);
  assert.equal(isHotelInAoryxArea(25.11, 55.146, "dubai-marina"), false);
  assert.equal(isHotelInAoryxArea(25.115, 55.1375, "palm-jumeirah"), true);
  assert.equal(isHotelInAoryxArea(24.5331, 54.4429, "saadiyat-island"), true);
  assert.equal(isHotelInAoryxArea(24.4978, 54.6056, "yas-island"), true);
  assert.equal(isHotelInAoryxArea(25.089, 55.148, "saadiyat-island"), false);
  assert.equal(isHotelInAoryxArea(null, null, "dubai-marina"), false);
  assert.equal(isHotelInAoryxArea(NaN, Infinity, "dubai-marina"), false);
  const areaWithHole = {
    id: "hole", name: "Hole", bounds: [0, 0, 4, 4],
    geometries: [{ type: "Polygon", coordinates: [
      [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]],
      [[1, 1], [3, 1], [3, 3], [1, 3], [1, 1]],
    ] }],
  };
  assert.equal(isHotelInArea(0.5, 0.5, areaWithHole), true);
  assert.equal(isHotelInArea(2, 2, areaWithHole), false);
});

test("server searches filter area hotels before returning prices and counts", async (t) => {
  const previous = globalThis.fetch;
  t.after(() => { globalThis.fetch = previous; });
  const hotel = (Code, Lat, Lon) => ({ Code, MinPrice: 100, HotelInfo: { Name: Code, Lat, Lon } });
  const hotels = [
    hotel("MARINA", "25.089", "55.148"), hotel("JBR", "25.078", "55.132"),
    hotel("PALM", "25.115", "55.1375"), hotel("SAADIYAT", "24.5331", "54.4429"),
    hotel("YAS", "24.4978", "54.6056"), hotel("UNKNOWN", null, null),
  ];
  globalThis.fetch = async (_url, init) => {
    const sent = JSON.parse(init.body);
    assert.equal(sent.SearchParameter.areaId, undefined, "area filtering stays local to Megatours");
    assert.ok(["160-0", "604-0"].includes(sent.SearchParameter.DestinationCode));
    return Response.json({
      GeneralInfo: { SessionId: "fixture-session" }, Monetary: { Currency: { Code: "USD" } },
      Hotels: { Hotel: hotels }, Audit: { PropertyCount: hotels.length },
    });
  };
  for (const [destinationCode, areaId, expected] of [
    ["160-0", "dubai-marina", ["MARINA", "JBR"]],
    ["160-0", "palm-jumeirah", ["PALM"]],
    ["604-0", "saadiyat-island", ["SAADIYAT"]],
    ["604-0", "yas-island", ["YAS"]],
  ]) {
    const result = await runAoryxSearch({ ...params, destinationCode, areaId });
    assert.deepEqual(result.hotels.map((entry) => entry.code), expected);
    assert.equal(result.propertyCount, expected.length);
    assert.equal(result.hotels[0].minPrice, 120);
    assert.equal(result.sessionId, undefined);
    assert.ok(result.searchToken);
  }
  assert.equal((await runAoryxSearch(params)).hotels.length, hotels.length);
});
