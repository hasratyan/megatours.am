import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

// Exercise real client/routes without loading .env, contacting Aoryx or a DB,
// creating a booking, or sending email.
const root = fileURLToPath(new URL("../", import.meta.url));
const mocks = {
  "next/server": "export { NextRequest, NextResponse } from 'next/server.js'; export const after = () => {};",
  "@/lib/pricing": "export const getAoryxHotelPlatformFee = async () => 0.1; export const getAoryxHotelB2BPlatformFee = async () => { throw Error('B2C must not use B2B markup'); };",
  "@/lib/aoryx-error-log": "export const logAoryxEndpointError = async () => {};",
  "@/lib/aoryx-flow-logger": "export const logAoryxFlow = () => {};",
  "@/lib/search-history": "export const scheduleSearchHistory = () => {};",
  "@/lib/aoryx-room-localization": "export const localizeAoryxRoomOptions = async rooms => rooms;",
  "@/lib/text-translation": "export const resolveTranslationLocale = () => 'en';",
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier in mocks) return { url: `tax-test:${specifier}`, shortCircuit: true };
    if (specifier.startsWith("@/")) return next(pathToFileURL(`${root}${specifier.slice(2)}.ts`).href, context);
    if (specifier.startsWith(".") && context.parentURL?.startsWith(pathToFileURL(root).href)) {
      const url = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(url))) return next(url.href, context);
    }
    return next(specifier, context.parentURL?.startsWith("tax-test:") ? { ...context, parentURL: import.meta.url } : context);
  },
  load(url, context, next) {
    if (url.startsWith("tax-test:")) return { format: "module", shortCircuit: true, source: mocks[url.slice(9)] };
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
  AORYX_RATE_TOKEN_SECRET: "tax-pricing-fixture-only", AORYX_ALL_ENDPOINT_FLOW_LOGS: "false",
});
const { NextRequest } = await import("next/server.js");
const { searchWithOptions, roomDetailsBySession } = await import("../lib/aoryx-client.ts");
const { runAoryxSearch } = await import("../lib/aoryx-search.ts");
const { getAoryxRateAmount, withAoryxDisplayPrice } = await import("../lib/aoryx-pricing.ts");
const { groupCompleteRoomOptions } = await import("../lib/aoryx-room-groups.ts");
const { summarizeHotelMealPrices } = await import("../lib/aoryx-meal-pricing.ts");
const { calculateBookingTotal } = await import("../lib/booking-total.ts");
const { POST: legacySearch } = await import("../app/api/aoryx/search/route.ts");
const { POST: roomDetails } = await import("../app/api/aoryx/room-details/route.ts");
const { POST: prebook } = await import("../app/api/aoryx/prebook/route.ts");
const year = new Date().getUTCFullYear() + 1;
const params = {
  destinationCode: "605-0", hotelCode: "424789", countryCode: "AE", nationality: "AM", currency: "USD",
  checkInDate: `${year}-12-30`, checkOutDate: `${year + 1}-01-10`,
  rooms: [{ roomIdentifier: 1, adults: 2, childrenAges: [8] }],
};
const offer = (key, meal, gross, net, identifier = 1, combination = 1) => ({
  RoomIdentifier: identifier, RoomCombinationId: combination, GroupCode: 175,
  RoomName: "Deluxe King", MealCode: meal, RateKey: key, RateType: "Refundable", Status: "Available",
  Price: { Gross: gross, Net: net, Tax: net - gross },
});
const availability = rooms => ({
  GeneralInfo: { SessionId: "tax-pricing-session" }, Monetary: { Currency: { Code: "USD" } },
  Hotels: { Hotel: [{ Code: params.hotelCode, MinPrice: 1, GroupCode: 175, HotelInfo: { Name: "Sheraton Sharjah" }, Rooms: { Room: rooms } }] },
  Audit: { PropertyCount: 1 },
});
const request = (path, body) => new NextRequest(`https://megatours.invalid/api/aoryx/${path}`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const mockAvailability = (t, rooms) => {
  const previous = globalThis.fetch;
  t.after(() => { globalThis.fetch = previous; });
  globalThis.fetch = async url => {
    assert.equal(String(url), "https://supplier.invalid/AvailabilityDetail");
    return Response.json(availability(rooms));
  };
};

test("display amount prefers positive finite Net and safely falls back to Gross", () => {
  assert.equal(getAoryxRateAmount({ gross: 1762.11, net: 2211.45 }), 2211.45);
  for (const net of [undefined, null, 0, -1, NaN, Infinity]) {
    assert.equal(getAoryxRateAmount({ gross: 100, net }), 100);
  }
  assert.equal(getAoryxRateAmount({ gross: 0, net: NaN }), null);
  assert.equal(getAoryxRateAmount(null), null);
});

test("Sheraton cards, meal starting prices, room details and payable totals include tax with identical B2C markup", async t => {
  mockAvailability(t, [offer("sheraton-ro", "RO", 1762.11, 2211.45), offer("sheraton-bb", "BB", 1800, 2300)]);
  const result = await runAoryxSearch(params);
  const detailResponse = await roomDetails(request("room-details", { ...params, searchToken: result.searchToken }));
  assert.equal(detailResponse.status, 200, await detailResponse.clone().text());
  const details = await detailResponse.json();
  const first = [...details.rooms].sort((a, b) => a.displayTotalPrice - b.displayTotalPrice)[0];
  assert.equal(result.hotels[0].minPrice, first.displayTotalPrice);
  assert.equal(first.displayTotalPrice, 2211.45 * 1.1);
  assert.equal(first.totalPrice, 2211.45);
  assert.equal(first.price.gross, 1762.11, "raw supplier prices must remain unchanged");
  assert.equal(first.price.net, 2211.45);
  const card = summarizeHotelMealPrices(result.hotels[0], "USD", [], null, "USD");
  assert.equal(card.displayPrice, Math.round(first.displayTotalPrice));
  const breakfast = summarizeHotelMealPrices(result.hotels[0], "USD", ["BB"], null, "USD");
  assert.equal(breakfast.displayPrice, Math.round(details.rooms.find(room => room.mealCode === "BB").displayTotalPrice));
  assert.equal(calculateBookingTotal({ rooms: [{ price: first.price }] }, { hotelMarkup: 0.1 }), first.displayTotalPrice);
  const legacyResponse = await legacySearch(request("search", params));
  assert.equal((await legacyResponse.json()).hotels[0].minPrice, result.hotels[0].minPrice);
});

test("the lowest Net offer wins even when Gross sorts the offers differently", async t => {
  mockAvailability(t, [offer("gross-cheapest", "RO", 1593.83, 2018.77), offer("net-cheapest", "RO", 1901.16, 1901.16)]);
  const search = await searchWithOptions(params);
  const details = await roomDetailsBySession("earlier-session", params);
  assert.equal(search.hotels[0].minPrice, 1901.16);
  assert.equal(search.hotels[0].availableRates[0].amount, 1901.16);
  const first = [...details.rooms].sort((a, b) => a.totalPrice - b.totalPrice)[0];
  assert.equal(first.rateKey, "net-cheapest");
  assert.equal(first.totalPrice, search.hotels[0].minPrice);
});

test("multi-room search and details sum only complete compatible tax-inclusive room combinations", async t => {
  const rooms = [
    offer("ro-1", "RO", 80, 100, 1, 1), offer("ro-2", "RO", 150, 210, 2, 1),
    offer("bb-1", "BB", 80, 140, 1, 2), offer("bb-2", "BB", 120, 130, 2, 2),
    offer("incomplete", "HB", 1, 1, 1, 3),
  ];
  mockAvailability(t, rooms);
  const multiParams = { ...params, rooms: [...params.rooms, { roomIdentifier: 2, adults: 2, childrenAges: [] }] };
  const result = await searchWithOptions(multiParams);
  const details = await roomDetailsBySession("earlier-session", multiParams);
  assert.equal(result.hotels[0].minPrice, 270);
  assert.deepEqual(result.hotels[0].availableRates, [{ mealCode: "RO", amount: 310 }, { mealCode: "BB", amount: 270 }]);
  const groups = groupCompleteRoomOptions(details.rooms, multiParams.rooms);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map(group => group.items.reduce((sum, room) => sum + room.totalPrice, 0)), [310, 270]);
});

test("PreBook hands off refreshed tax-inclusive marked totals without altering supplier prices", async t => {
  const previous = globalThis.fetch;
  t.after(() => { globalThis.fetch = previous; });
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://supplier.invalid/PreBook");
    assert.deepEqual(JSON.parse(init.body).SearchParameter.RateKeys.RateKey, ["repriced-rate"]);
    return Response.json({ GeneralInfo: { SessionId: "tax-pricing-session" }, IsBookable: true, IsPriceChanged: true,
      Hotel: { Code: params.hotelCode, Rooms: { Room: [offer("repriced-rate", "RO", 220, 310)] } } });
  };
  const response = await prebook(request("prebook", { sessionId: "tax-pricing-session", hotelCode: params.hotelCode, groupCode: 175, rateKeys: ["repriced-rate"], currency: "USD", locale: "en" }));
  assert.equal(response.status, 200, await response.clone().text());
  const result = await response.json();
  assert.equal(result.rooms[0].totalPrice, 310);
  assert.equal(result.rooms[0].displayTotalPrice, 341);
  assert.equal(result.rooms[0].price.gross, 220);
  assert.equal(result.rooms[0].price.net, 310);

  // Run the actual UI handoff function, without rendering or importing Next UI.
  const sourceFile = ts.createSourceFile("hotel-client.tsx", readFileSync(`${root}app/[locale]/hotels/[code]/hotel-client.tsx`, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = sourceFile.statements.find(statement => ts.isVariableStatement(statement) && statement.declarationList.declarations.some(item => item.name.getText(sourceFile) === "mergePrebookExtras"));
  assert.ok(declaration);
  const js = ts.transpileModule(`${declaration.getText(sourceFile)}\nexport { mergePrebookExtras };`, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
  const { mergePrebookExtras } = await import(`data:text/javascript,${encodeURIComponent(js)}`);
  const selected = withAoryxDisplayPrice({ roomIdentifier: 1, rateKey: "opaque-selected-rate", price: { gross: 200, net: 280 }, totalPrice: 280 }, 0.1);
  const updated = mergePrebookExtras([selected], result.rooms)[0];
  assert.equal(updated.displayTotalPrice, 341);
  assert.equal(updated.totalPrice, 310);
  assert.equal(updated.rateKey, "opaque-selected-rate");
  assert.equal(calculateBookingTotal({ rooms: [{ price: updated.price }] }, { hotelMarkup: 0.1 }), updated.displayTotalPrice);
});
