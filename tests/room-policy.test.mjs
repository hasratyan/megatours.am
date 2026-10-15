import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRoomPolicyDate, summarizeRoomPolicy } from "../lib/room-policy.ts";

const now = Date.parse("2026-10-16T12:00:00Z");
const condition = (fromDate, fixed = 100, extra = {}) => ({
  fromDate, toDate: null, fromTime: null, toTime: null, timezone: null,
  unit: null, text: null, percentage: null, nights: null, fixed, applicableOn: null, ...extra,
});
const room = (...conditions) => ({policies: [{type: "CAN", currency: "EUR", textCondition: null, conditions}]});
const summarize = (rooms, nonRefundable = false) =>
  summarizeRoomPolicy(rooms, nonRefundable, "en-GB", "Refundable until", now);

test("normalized policy dates retain the precise supplied deadline for full terms", () => {
  assert.equal(normalizeRoomPolicyDate("07-11-2026 23:59:00"), "2026-11-07T23:59:00");
  assert.equal(normalizeRoomPolicyDate("2026-11-06T00:00:00+14:00"), "2026-11-06T00:00:00+14:00");
  assert.equal(normalizeRoomPolicyDate("2026-11-06 invalid"), null);
});

test("non-refundable and unknown options never display a refundable deadline", () => {
  const rooms = [room(condition("2026-11-06T00:00:00Z"))];
  assert.equal(summarize(rooms, true), null);
  assert.equal(summarize(rooms, null), null);
});

test("room deadlines normalize day-first timestamps and ignore zero-charge start dates", () => {
  assert.equal(summarize([room(
    condition("14-10-2026 00:00:00", 0),
    condition("07-11-2026 00:00:00", 369.71),
  )]), "Refundable until 7 Nov 2026");
});

test("the earliest penalty date across every requested room defines the bundle deadline", () => {
  assert.equal(summarize([
    room(condition("2026-11-09T23:59:00-05:00")),
    room(condition("2026-11-06T00:00:00+14:00", null, {percentage: 77}), condition("2026-11-12", null, {percentage: 100})),
  ]), "Refundable until 6 Nov 2026");
});

test("missing, malformed and expired dates do not invent a free-cancellation period", () => {
  for (const rooms of [
    [], [{}], [room(condition("invalid"))], [room(condition("31-02-2027"))],
    [room(condition("2026-10-15"), condition("2026-11-06"))],
    [room(condition("2026-11-06")), {}],
    [room(condition("2026-11-06"), condition(null))],
  ]) assert.equal(summarize(rooms), null);
});

test("a free-cancellation window can supply its end date; no-show dates cannot", () => {
  const refundableRoom = room(condition("2026-10-14", 0, {toDate: "2026-11-05", toTime: "23:59"}));
  refundableRoom.policies.push({type: "NOS", conditions: [condition("2026-10-14")]});
  assert.equal(summarize([refundableRoom]), "Refundable until 5 Nov 2026");
  assert.equal(summarize([{policies: [{type: "NOS", conditions: [condition("2026-11-06")]}]}]), null);
});

test("localized date-only labels retain the supplied calendar date across timezones", () => {
  for (const [locale, label] of [["hy-AM", "Վերադարձվող է մինչև"], ["ru-RU", "Возврат возможен до"]]) {
    const summary = summarizeRoomPolicy([room(condition("2026-11-06T00:00:00+14:00"))], false, locale, label, now);
    const date = new Intl.DateTimeFormat(locale, {year:"numeric", month:"short", day:"numeric", timeZone:"UTC"}).format(new Date("2026-11-06T00:00:00Z"));
    assert.equal(summary, `${label} ${date}`);
    assert.doesNotMatch(summary, /T\d{2}:|\d{2}:\d{2}/);
  }
});
