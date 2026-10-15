import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(pathToFileURL(`${root}${specifier.slice(2)}.ts`).href, context);
  if (specifier.startsWith(".") && context.parentURL?.startsWith(pathToFileURL(root).href) && !specifier.endsWith(".ts")) {
    const target = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(fileURLToPath(target))) return next(target.href, context);
  }
  return next(specifier, context);
} });

const data = new Map();
const events = new EventTarget();
globalThis.window = {
  location: { pathname: "/en/uae" },
  localStorage: { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: (key) => data.delete(key) },
  dispatchEvent: events.dispatchEvent.bind(events), addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
};
const { destinationFromPath, requiredServices } = await import("../lib/destinations/registry.ts");
const { validatePackageDraft, isPackageComplete } = await import("../lib/packages/policy.ts");
const state = await import("../lib/package-builder-state.ts");
const now = Date.parse("2026-10-14T12:00:00Z");
const quote = (service) => ({ id: `quote-${service}`, service, destinationId: "cyprus", ownerId: "customer-1", contextKey: "trip-1", price: { amount: 100, currency: "EUR" }, expiresAt: new Date(now + 60_000).toISOString(), validated: true });
const draft = (selectedServices, quotes) => ({ version: 1, destinationId: "cyprus", selectedServices, ownerId: "customer-1", contextKey: "trip-1", quotes });

test("free combinations require the hotel and each selected extra", () => {
  for (const selected of [[], ["transfer"], ["flight"], ["transfer", "flight"]]) {
    const quotes = Object.fromEntries(requiredServices(selected).map((service) => [service, quote(service)]));
    validatePackageDraft(draft(selected, quotes), now);
    assert.equal(isPackageComplete(selected, Object.fromEntries(requiredServices(selected).map((service) => [service, "confirmed"]))), true);
    if (selected.length) assert.equal(isPackageComplete(selected, { hotel: "confirmed" }), false);
  }
  assert.throws(() => validatePackageDraft(draft(["transfer", "flight"], {hotel: quote("hotel"), transfer: quote("transfer")}), now), /flight quote is required/);
  assert.throws(() => validatePackageDraft(draft([], {transfer: quote("transfer")}), now));
  assert.throws(() => validatePackageDraft(draft([], {hotel: quote("hotel"), flight: quote("flight")}), now), /unselected service/);
  assert.equal(isPackageComplete(["transfer", "flight"], { hotel: "confirmed", transfer: "confirmed", flight: "unknown" }), false);
});

test("quotes cannot cross destinations, owners or travel context, or outlive expiry", () => {
  for (const change of [{ destinationId: "uae" }, { ownerId: "customer-2" }, { contextKey: "another-trip" }, { expiresAt: new Date(now).toISOString() }, { expiresAt: "invalid" }, { price: { amount: -1, currency: "EUR" } }]) {
    assert.throws(() => validatePackageDraft(draft([], { hotel: { ...quote("hotel"), ...change } }), now));
  }
});

test("destination resolution preserves legacy UAE links and leaves shared pages neutral", () => {
  for (const path of ["/en/uae", "/hy/results", "/ru/hotels/123", "/en/dubai", "/en/checkout"]) assert.equal(destinationFromPath(path), "uae");
  assert.equal(destinationFromPath("/en/cyprus"), "cyprus");
  assert.equal(destinationFromPath("/ru/cyprus/checkout"), "cyprus");
  for (const path of ["/en", "/en/profile", "/en/not-a-destination", "/en/cyprus-malformed"]) assert.equal(destinationFromPath(path), null);
});

test("legacy UAE drafts survive switching, while Cyprus and owner drafts stay isolated", () => {
  data.clear();
  const legacy = { hotel: { selected: true, hotelCode: "AE-1", countryCode: "AE", rooms: [{ roomIdentifier: 1, adults: 2, childrenAges: [] }] } };
  data.set("megatours-package-builder", JSON.stringify(legacy));
  window.location.pathname = "/en/uae";
  assert.equal(state.readPackageBuilderState().hotel.hotelCode, "AE-1");
  state.writePackageBuilderStateForOwner("customer-1", legacy);
  state.writePackageBuilderOwner("customer-1");
  window.location.pathname = "/en/cyprus";
  assert.deepEqual(state.readPackageBuilderState(), {});
  assert.deepEqual(state.readPackageBuilderStateForOwner("customer-1"), {});
  assert.equal(state.readPackageBuilderOwner(), null);
  state.writePackageBuilderState({ hotel: { selected: true, hotelCode: "CY-1", countryCode: "CY" } });
  assert.throws(() => state.writePackageBuilderState(legacy), /another destination/);
  state.writePackageBuilderStateForOwner("customer-1", state.readPackageBuilderState());
  state.resetPackageBuilderState();
  window.location.pathname = "/en/uae";
  assert.equal(state.readPackageBuilderState().hotel.hotelCode, "AE-1");
  assert.equal(state.readPackageBuilderStateForOwner("customer-1").hotel.hotelCode, "AE-1");
  assert.equal(state.readPackageBuilderOwner(), "customer-1");
});

test("a draft copied into another destination storage key cannot restore supplier data", () => {
  window.location.pathname = "/en/cyprus";
  data.set("megatours-package-builder:cyprus", JSON.stringify({ destinationId: "uae", hotel: { selected: true, hotelCode: "AE-secret" } }));
  assert.deepEqual(state.readPackageBuilderState(), {});
  data.set("megatours-package-builder:cyprus", JSON.stringify({ hotel: { selected: true, hotelCode: "AE-secret", countryCode: "AE" } }));
  assert.deepEqual(state.readPackageBuilderState(), {});
});

const { parseSearchParams, buildSearchQuery } = await import("../lib/search-query.ts");
const { presentHotelRooms, presentHotelSearch } = await import("../lib/packages/hotel-presentation.ts");
const { summarizeRoomPolicy } = await import("../lib/room-policy.ts");
test("shared search keeps Cyprus country, package and multi-room totals together", () => {
  const {payload} = parseSearchParams(new URLSearchParams({destinationId:"cyprus",countryCode:"AE",destinationCode:"CITY_CY_1",checkInDate:"2026-10-16",checkOutDate:"2026-10-20",bookingMode:"hotel_transfer",rooms:JSON.stringify([{roomIdentifier:1,adults:2,childrenAges:[]},{roomIdentifier:2,adults:1,childrenAges:[8]}])}));
  assert.equal(payload.countryCode,"CY");
  assert.equal(new URLSearchParams(buildSearchQuery(payload)).has("bookingMode"),false);
  const offer={id:"opaque-quote",hotel:{id:"CY-hotel",name:"Cyprus hotel",city:"Larnaca",stars:4,destinationId:"cyprus"},roomName:"Complete room set",mealPlan:"BB",price:{amount:100.01,currency:"EUR"},cancellationPolicies:[],payAtProperty:[],notices:[]};
  const rooms=presentHotelRooms(offer,payload);
  assert.equal(Math.round(rooms.reduce((sum,room)=>sum+room.totalPrice,0)*100),10001);
  assert.equal(new Set(rooms.map(room=>room.groupIdentity)).size,1);
  const result=presentHotelSearch({offers:[offer],partial:true,nextOffset:60},payload);
  assert.equal(result.partial,true); assert.equal(result.nextOffset,60); assert.equal(result.hotels[0].code,"CY-hotel");
});

test("Cyprus room cards derive a date-only deadline while preserving complete cancellation terms", () => {
  const offer = {id:"opaque-quote", roomName:"Double", mealPlan:"BB", refundable:true, price:{amount:100.01,currency:"EUR"}, cancellationPolicies:[
    {from:"14-10-2026 00:00:00", amount:0, currency:"USD", type:"amount"},
    {from:"07-11-2026 00:00:00", amount:369.71, currency:"USD", type:"amount"},
    {from:"2026-11-12T00:00:00", amount:100, currency:"EUR", type:"percent"},
  ], payAtProperty:[], notices:[]};
  const rooms = presentHotelRooms(offer, {rooms:[{roomIdentifier:1,adults:2,childrenAges:[]}]});
  assert.equal(summarizeRoomPolicy(rooms, false, "en-GB", "Refundable until", now), "Refundable until 7 Nov 2026");
  assert.equal(rooms[0].totalPrice, 100.01);
  assert.equal(rooms[0].policies[1].currency, "USD");
  assert.equal(rooms[0].policies[1].conditions[0].fromDate, "2026-11-07T00:00:00");
  assert.equal(rooms[0].policies[1].conditions[0].fixed, 369.71);
  assert.equal(rooms[0].policies[2].conditions[0].percentage, 100);
  assert.equal(rooms[0].cancellationPolicy, "14-10-2026 00:00:00: 0 USD\n07-11-2026 00:00:00: 369.71 USD\n2026-11-12T00:00:00: 100 %");
  assert.equal(summarizeRoomPolicy(rooms, true, "en-GB", "Refundable until", now), null);
});

const { applyDestinationServiceQuote, removeDestinationService, destinationPackageReviewInput, isDestinationPackageReady } = await import("../lib/packages/selection.ts");
const hotelDraft = () => ({destinationId:"cyprus",hotel:{selected:true,hotelCode:"CY-1",countryCode:"CY"},destinationQuotes:{hotel:{offer:{id:"hotel-quote",expiresAt:new Date(now+60000).toISOString()},contextKey:"trip-1"}},insurance:{selected:true,planId:"elite",price:2000},excursion:undefined});
test("selected insurance stays pending until priced and can be removed for hotel only", () => {
  const current = hotelDraft();
  for (const patch of [{price:null}, {quoteLoading:true}, {quoteError:"unavailable"}, {price:0}]) {
    assert.equal(isDestinationPackageReady({...current, insurance:{...current.insurance, ...patch}}, now), false);
  }
  assert.equal(isDestinationPackageReady(current, now), true);
  assert.equal(isDestinationPackageReady(removeDestinationService(current, "insurance"), now), true);
});
const extra = (service,id=service) => ({offer:{id,service,destinationId:"cyprus",hotelOfferId:"hotel-quote",contextKey:"trip-1",expiresAt:new Date(now+60000).toISOString(),title:service,price:{amount:100,currency:"EUR"},journeys:[{from:"EVN",to:"LCA",departure:"2026-11-01",description:""}]}});
test("adding flight preserves transfer and defaults; removing or changing one preserves the other", () => {
  let current = applyDestinationServiceQuote(hotelDraft(),extra("transfer"));
  current = applyDestinationServiceQuote(current,extra("flight"));
  assert.equal(current.transfer.selected,true); assert.equal(current.flight.selected,true);
  assert.equal(current.insurance.planId,"elite");
  assert.deepEqual(destinationPackageReviewInput(current).serviceOfferIds,["transfer","flight"]);
  assert.equal(isDestinationPackageReady(current,now),true);
  current=applyDestinationServiceQuote(current,extra("flight","replacement-flight"));
  assert.deepEqual(destinationPackageReviewInput(current).serviceOfferIds,["transfer","replacement-flight"]);
  const removed=removeDestinationService(current,"transfer");
  assert.equal(removed.transfer,undefined);assert.equal(removed.flight.selected,true);
  assert.deepEqual(destinationPackageReviewInput(removed).serviceOfferIds,["replacement-flight"]);
  assert.equal(isDestinationPackageReady(removed,now),true);
  assert.equal(isDestinationPackageReady({...current,destinationQuotes:{...current.destinationQuotes,services:{transfer:current.destinationQuotes.services.transfer}}},now),false);
  assert.equal(applyDestinationServiceQuote(current,{offer:{...extra("flight").offer,hotelOfferId:"another-hotel"}}),current);
});
test("legacy trip types migrate to independent service quotes without losing defaults", () => {
  window.location.pathname="/en/cyprus";
  const old={...hotelDraft(),bookingMode:"hotel_transfer",transfer:{selected:true},destinationQuotes:{...hotelDraft().destinationQuotes,service:extra("transfer")}};
  data.set("megatours-package-builder:cyprus",JSON.stringify(old));
  const migrated=state.readPackageBuilderState();
  assert.equal(migrated.bookingMode,undefined);assert.equal(migrated.destinationQuotes.service,undefined);
  assert.equal(migrated.destinationQuotes.services.transfer.offer.id,"transfer");assert.equal(migrated.insurance.planId,"elite");
});
