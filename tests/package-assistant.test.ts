import assert from "node:assert/strict";
import test from "node:test";
import type { AoryxRoomOption } from "../types/aoryx";
// @ts-expect-error Node's built-in TypeScript test runner requires the source extension.
import { labelMissingFields, normalizeMissingFieldKey } from "../lib/package-assistant-fields.ts";
// @ts-expect-error Node's built-in TypeScript test runner requires the source extension.
import { selectBookableRoomGroup } from "../lib/package-assistant-room-group.ts";
// @ts-expect-error Node's built-in TypeScript test runner requires the source extension.
import { extractStreamingMessage } from "../lib/package-assistant-stream.ts";
// @ts-expect-error Node's built-in TypeScript test runner requires the source extension.
import { resolveScopedAssistantSessionId } from "../lib/package-assistant-session.ts";

test("missing-field names are human-readable in every locale", () => {
  const fields = ["year", "childAge", "roomCount", "budget", "budgetAmount"];
  assert.deepEqual(labelMissingFields(fields, "hy"), [
    "ճամփորդության տարին", "երեխաների տարիքները", "սենյակների քանակը", "Ձեր բյուջեն",
  ]);
  assert.deepEqual(labelMissingFields(fields, "en"), [
    "travel year", "children's ages", "number of rooms", "your budget",
  ]);
  assert.deepEqual(labelMissingFields(fields, "ru"), [
    "год поездки", "возраст детей", "число номеров", "ваш бюджет",
  ]);
  assert.equal(normalizeMissingFieldKey("checkInDate"), "checkindate");
});

test("stream extraction emits only the assistant message, handling escaped text", () => {
  assert.equal(extractStreamingMessage('{"stage":"ready","message":"Hello'), "Hello");
  assert.equal(extractStreamingMessage('{"message":"Say \\"hi\\""'), 'Say "hi"');
  assert.equal(extractStreamingMessage('{"missing":["budget"]}'), "");
  assert.equal(extractStreamingMessage('{"message":"\u0540\u0561\u0575'), "Հայ");
});

test("sessions cannot continue across owners or without a guest owner cookie", () => {
  const fresh = () => "new-session";
  assert.equal(resolveScopedAssistantSessionId("old", { ownerKey: "guest:a" }, "guest:b", true, fresh), "new-session");
  assert.equal(resolveScopedAssistantSessionId("old", { ownerKey: "guest:a" }, "guest:a", false, fresh), "new-session");
  assert.equal(resolveScopedAssistantSessionId("old", {}, "guest:a", true, fresh), "new-session");
  assert.equal(resolveScopedAssistantSessionId("old", { ownerKey: "guest:a" }, "guest:a", true, fresh), "old");
  assert.equal(resolveScopedAssistantSessionId("new", null, "guest:a", true, fresh), "new");
});

const room = (groupCode: number, roomIdentifier: number, totalPrice: number, rateKey: string) => ({
  groupCode, roomIdentifier, totalPrice, rateKey,
}) as AoryxRoomOption;

test("bookable group requires every room and chooses the lowest complete group", () => {
  const selected = selectBookableRoomGroup([
    room(1, 1, 20, "incomplete"),
    room(2, 1, 80, "expensive-1"), room(2, 2, 90, "expensive-2"),
    room(3, 1, 50, "cheap-1"), room(3, 2, 60, "cheap-2"),
    room(4, 1, 1, ""), room(4, 2, 2, "unusable"),
  ], 2);
  assert.equal(selected?.groupCode, 3);
  assert.deepEqual(selected?.rooms.map((entry) => entry.rateKey), ["cheap-1", "cheap-2"]);
  assert.equal(selectBookableRoomGroup([room(1, 1, 50, "only")], 2), null);
  assert.equal(selectBookableRoomGroup([{
    ...room(5, 1, 70, "single"), roomIdentifier: null,
  }], 1)?.groupCode, 5);
});
