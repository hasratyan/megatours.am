import assert from "node:assert/strict";
import test from "node:test";
import { HOTEL_SEARCH_FRESH_MS, hotelImageTransitionName, isHotelSearchFresh } from "../lib/hotel-navigation.ts";

const completed = { key: "destination=160&rooms=2", attempt: 0, receivedAt: 1000 };

test("returning to the same recent search retains its availability", () => {
  assert.equal(isHotelSearchFresh(completed, completed.key, 0, 1001), true);
  assert.equal(isHotelSearchFresh(completed, completed.key, 0, 1000 + HOTEL_SEARCH_FRESH_MS - 1), true);
});

test("expired results refresh at the freshness boundary", () => {
  assert.equal(isHotelSearchFresh(completed, completed.key, 0, 1000 + HOTEL_SEARCH_FRESH_MS), false);
});

test("new criteria and explicit retry always refresh availability", () => {
  assert.equal(isHotelSearchFresh(completed, "destination=160&rooms=4", 0, 1001), false);
  assert.equal(isHotelSearchFresh(completed, completed.key, 1, 1001), false);
  assert.equal(isHotelSearchFresh(null, completed.key, 0, 1001), false);
  assert.equal(isHotelSearchFresh(completed, completed.key, 0, 999), false);
});

test("transition identities are CSS-safe and distinct for supplier hotel codes", () => {
  const codes = ["123", "abc-123", "abc_123", "ABC-123", "Հյուրանոց"];
  const names = codes.map(hotelImageTransitionName);
  assert.equal(new Set(names).size, codes.length);
  assert.ok(names.every(name => /^hotel-image-[0-9a-f_]+$/.test(name)));
  assert.equal(hotelImageTransitionName("123"), hotelImageTransitionName("123"));
});
