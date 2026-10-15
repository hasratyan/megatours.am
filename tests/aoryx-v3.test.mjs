import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const mocks = {
  "@/lib/aoryx-error-log": "export const logAoryxEndpointError = async () => {};",
  "@/lib/aoryx-flow-logger": "export const logAoryxFlow = () => {};",
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier in mocks) return { url: `aoryx-test:${specifier}`, shortCircuit: true };
    if (specifier.startsWith("@/")) return next(pathToFileURL(`${root}${specifier.slice(2)}.ts`).href, context);
    if (specifier.startsWith(".") && context.parentURL?.startsWith(pathToFileURL(root).href)) {
      const url = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(url))) return next(url.href, context);
    }
    return next(specifier, context.parentURL?.startsWith("aoryx-test:") ? { ...context, parentURL: import.meta.url } : context);
  },
  load(url, context, next) {
    if (url.startsWith("aoryx-test:")) return { format: "module", shortCircuit: true, source: mocks[url.slice(11)] };
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
  AORYX_ENV: "live",
  AORYX_BASE_URL: "https://supplier.invalid",
  AORYX_API_KEY: "fixture-only",
});

const { searchWithOptions, roomDetailsBySession, preBook, bookingDetails } = await import("../lib/aoryx-client.ts");
const { isAoryxBookingResultConfirmed } = await import("../lib/booking-status.ts");
const { buildSearchQuery, parseSearchParams } = await import("../lib/search-query.ts");
const { summarizeHotelMealPrices } = await import("../lib/aoryx-meal-pricing.ts");
const { groupCompleteRoomOptions } = await import("../lib/aoryx-room-groups.ts");
const params = {
  destinationCode: "160-0", countryCode: "AE", nationality: "AM", currency: "USD",
  checkInDate: "2026-11-15", checkOutDate: "2026-11-17", meals: ["BB"],
  rooms: [{ roomIdentifier: 1, adults: 2, childrenAges: [] }],
};
const room = {
  RoomIdentifier: 1, RoomName: "Deluxe", MealCode: null, Meal: "Bed and Breakfast",
  RateType: "Refundable", RateKey: "rate-1", GroupCode: 175,
  Price: { Gross: 100, Net: 120, Tax: 20 },
  Policies: { Policy: [{ Type: "CAN", Condition: [{ Fixed: 25 }] }] },
};
const availability = {
  GeneralInfo: { SessionId: "hotel-session" }, Monetary: { Currency: { Code: "USD" } },
  Hotels: { Hotel: [{ Code: "H1", MinPrice: 100, HotelInfo: { Name: "Fixture Hotel" }, Rooms: { Room: [room, { ...room, RateKey: "rate-2", Price: { ...room.Price, Gross: 130 } }] } }] },
  Audit: { PropertyCount: 1 },
};

test("v3 availability supplies meal rates and hotel rooms; PreBook reprices their keys", async (t) => {
  const previous = globalThis.fetch;
  t.after(() => { globalThis.fetch = previous; });
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    const sent = JSON.parse(init.body);
    if (String(url).endsWith("/AvailabilityDetail")) {
      assert.equal(sent.SearchParameter.Meals, "BB");
      assert.equal(sent.SearchParameter.TassProInfo.CustomerCode, "5993");
      return Response.json(availability);
    }
    assert.equal(String(url), "https://supplier.invalid/PreBook");
    assert.equal(sent.SessionId, "hotel-session");
    assert.deepEqual(sent.SearchParameter.RateKeys.RateKey, ["rate-1"]);
    return Response.json({ GeneralInfo: { SessionId: "hotel-session" }, IsBookable: true,
      Hotel: { Rooms: { Room: [room] } } });
  };

  const result = await searchWithOptions(params);
  assert.deepEqual(result.hotels[0].availableRates, [{ mealCode: "BB", amount: 120 }]);
  const detail = await roomDetailsBySession("earlier-results-session", { ...params, hotelCode: "H1" });
  assert.equal(detail.sessionId, "hotel-session");
  assert.equal(detail.rooms[0].mealCode, "BB");
  assert.equal(detail.rooms[0].totalPrice, 120, "Net is the tax-inclusive v3 display price");
  assert.equal(detail.rooms[0].refundable, true);
  assert.equal(detail.rooms[0].policies[0].conditions[0].fixed, 25);
  const prebook = await preBook(detail.sessionId, "H1", 175, ["rate-1"], "USD");
  assert.equal(prebook.isBookable, true);
  assert.equal(prebook.rooms[0].rateKey, "rate-1");
  assert.deepEqual(calls, [
    "https://supplier.invalid/AvailabilityDetail",
    "https://supplier.invalid/AvailabilityDetail",
    "https://supplier.invalid/PreBook",
  ]);
});

test("selected meals trigger a new supplier search that can return additional hotels", async (t) => {
  const previous = globalThis.fetch;
  t.after(() => { globalThis.fetch = previous; });
  const request = { ...params, meals: undefined };
  const query = buildSearchQuery(request);
  assert.equal(new URLSearchParams(query).has("meals"), false);
  const broad = parseSearchParams(new URLSearchParams(query));
  assert.deepEqual(broad.payload?.meals, undefined);
  const selectedQuery = buildSearchQuery({ ...broad.payload, meals: ["HB"] });
  const selected = parseSearchParams(new URLSearchParams(selectedQuery));
  assert.deepEqual(selected.payload?.meals, ["HB"]);
  assert.deepEqual(parseSearchParams(new URLSearchParams(`${selectedQuery}&unused=1`)).payload?.meals, ["HB"]);

  const sentMeals = [];
  globalThis.fetch = async (_url, init) => {
    const meals = JSON.parse(init.body).SearchParameter.Meals;
    sentMeals.push(meals ?? null);
    const selectedHotel = meals
      ? { Code: "H2", MinPrice: 140, HotelInfo: { Name: "Half Board Hotel" }, Rooms: { Room: [{ ...room, MealCode: "HBP", Meal: "Half Board Plus", Price: { Gross: 140 } }] } }
      : { Code: "H1", MinPrice: 90, HotelInfo: { Name: "Room Only Hotel" }, Rooms: { Room: [{ ...room, MealCode: "RO", Meal: "Room Only", Price: { Gross: 90 } }] } };
    return Response.json({ ...availability, Hotels: { Hotel: [selectedHotel] } });
  };
  const broadResult = await searchWithOptions(broad.payload);
  const selectedResult = await searchWithOptions(selected.payload);
  assert.deepEqual(sentMeals, [null, "HB,HBP,HBD,HBPR"]);
  assert.deepEqual(broadResult.hotels.map((hotel) => hotel.code), ["H1"]);
  assert.deepEqual(selectedResult.hotels.map((hotel) => hotel.code), ["H2"]);
  assert.deepEqual(selectedResult.hotels[0].availableRates, [{ mealCode: "HB", amount: 140 }]);
});

test("hotel cards show each meal starting price and label the cheapest eligible rate", () => {
  const hotel = {
    minPrice: 80,
    currency: "USD",
    availableRates: [
      { mealCode: "BB", amount: 100 },
      { mealCode: "HB", amount: 150 },
      { mealCode: "FB", amount: 210 },
    ],
  };
  assert.deepEqual(summarizeHotelMealPrices(hotel, "USD", [], null, "USD"), {
    displayPrice: 100, displayCurrency: "USD", primaryMealCode: "BB",
    mealStartingPrices: [
      { code: "BB", amount: 100, currency: "USD" },
      { code: "HB", amount: 150, currency: "USD" },
      { code: "FB", amount: 210, currency: "USD" },
    ],
  });
  const halfBoard = summarizeHotelMealPrices(hotel, "USD", ["HB"], null, "USD");
  assert.equal(halfBoard.displayPrice, 150);
  assert.equal(halfBoard.primaryMealCode, "HB");
  assert.equal(summarizeHotelMealPrices(hotel, "USD", ["AI"], null, "USD").displayPrice, null);
});

test("four-room prices and bookable options require a complete supplier combination", async (t) => {
  const previous = globalThis.fetch;
  t.after(() => { globalThis.fetch = previous; });
  const rooms = [
    { roomIdentifier: 1, adults: 2, childrenAges: [] },
    { roomIdentifier: 2, adults: 1, childrenAges: [] },
    { roomIdentifier: 3, adults: 4, childrenAges: [] },
    { roomIdentifier: 4, adults: 1, childrenAges: [] },
  ];
  const makeRoom = (identifier, combination, mealCode, gross) => ({
    RoomIdentifier: identifier, RoomCombinationId: combination, MarriageIdentifier: combination,
    GroupCode: 175, RateKey: `rate-${combination}-${identifier}`, MealCode: mealCode,
    RoomName: `Room ${identifier}`, Status: "Available", Price: { Gross: gross },
  });
  const supplierRooms = [
    makeRoom(1, 1, "BB", 236),
    makeRoom(2, 1, "BB", 120),
    makeRoom(3, 1, "BB", 280),
    makeRoom(4, 1, "BB", 110),
    makeRoom(1, 2, "RO", 100),
    makeRoom(2, 2, "RO", 100),
    makeRoom(3, 2, "RO", 250),
    makeRoom(4, 2, "RO", 100),
    makeRoom(1, 3, "HB", 50), // An incomplete cheap rate must not become the hotel price.
  ];
  globalThis.fetch = async (_url, init) => {
    assert.deepEqual(JSON.parse(init.body).SearchParameter.Rooms.Room.map((item) => item.RoomIdentifier), [1, 2, 3, 4]);
    return Response.json({ ...availability, Hotels: { Hotel: [{
      Code: "H1", MinPrice: 50, HotelInfo: { Name: "Four Room Hotel" }, Rooms: { Room: supplierRooms },
    }] } });
  };
  const result = await searchWithOptions({ ...params, meals: undefined, rooms });
  assert.equal(result.hotels[0].minPrice, 550);
  assert.deepEqual(result.hotels[0].availableRates, [
    { mealCode: "BB", amount: 746 },
    { mealCode: "RO", amount: 550 },
  ]);
  const card = summarizeHotelMealPrices(result.hotels[0], "USD", [], null, "USD");
  assert.equal(card.displayPrice, 550);
  assert.equal(card.primaryMealCode, "RO");
  const grouped = groupCompleteRoomOptions(supplierRooms.map((item) => ({
    roomIdentifier: item.RoomIdentifier, roomCombinationId: item.RoomCombinationId,
    marriageIdentifier: item.MarriageIdentifier, groupCode: item.GroupCode,
    rateKey: item.RateKey, totalPrice: item.Price.Gross,
  })), rooms);
  assert.equal(grouped.length, 2);
  assert.deepEqual(grouped[0].items.map((item) => item.roomIdentifier), [1, 2, 3, 4]);
  assert.equal(grouped[0].items.reduce((sum, item) => sum + item.totalPrice, 0), 746);

  const incompleteOnly = groupCompleteRoomOptions([{
    roomIdentifier: 1, roomCombinationId: 9, rateKey: "one-room-rate", totalPrice: 50,
  }], rooms);
  assert.deepEqual(incompleteOnly, []);
  const sharedRate = groupCompleteRoomOptions(rooms.map((requested, index) => ({
    id: `room-type-${index}`,
    rateIdentity: "same-opaque-rate-identity",
    rateKey: `different-token-${index}`,
    roomIdentifier: requested.roomIdentifier,
    totalPrice: 100,
  })), rooms);
  assert.equal(sharedRate.length, 1);
  assert.equal(sharedRate[0].items.length, 4);
  assert.deepEqual(groupCompleteRoomOptions(rooms.map((requested, index) => ({
    roomIdentifier: requested.roomIdentifier,
    roomCombinationId: 99,
    groupIdentity: index === 3 ? "different-supplier-group" : "supplier-group",
    rateKey: `rate-${index}`,
    totalPrice: 100,
  })), rooms), []);
});

test("v3 nested BookingDetails confirms a booking after an uncertain Book response", async (t) => {
  const previous = globalThis.fetch;
  t.after(() => { globalThis.fetch = previous; });
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://supplier.invalid/BookingDetails");
    assert.deepEqual(JSON.parse(init.body), { SessionId: "hotel-session" });
    return Response.json({ GeneralInfo: { SessionId: "hotel-session" }, GenericBookingInfo: {
      CustomerRefNumber: "customer-1", AdsConfirmationNumber: "ADS-1", Status: 2,
      BookingInfo: { Rooms: { Room: [{ RoomIdentifier: 1, RateKey: "rate-1", Status: "Confirmed" }] } },
    } });
  };
  const result = await bookingDetails("hotel-session");
  assert.equal(result.status, "2");
  assert.equal(result.adsConfirmationNumber, "ADS-1");
  assert.equal(result.customerRefNumber, "customer-1");
  assert.equal(result.rooms[0].rateKey, "rate-1");
  assert.equal(isAoryxBookingResultConfirmed(result), true);
  assert.equal(isAoryxBookingResultConfirmed({ ...result, status: "1" }), false);
  assert.equal(isAoryxBookingResultConfirmed({ ...result, status: "Not Confirmed" }), false);
  assert.equal(isAoryxBookingResultConfirmed({ ...result, status: "3" }), false);
});
