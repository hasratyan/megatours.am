import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's built-in TypeScript test runner requires the source extension.
import { resolveBookingAddonPaymentMethods } from "../lib/booking-addon-payment-methods.ts";

const allEnabled = {
  idram: true,
  idbank_card: true,
  ameria_card: true,
};

test("admin payment is appended only for a server-verified admin", () => {
  assert.deepEqual(resolveBookingAddonPaymentMethods(allEnabled, true), [
    "idram",
    "idbank_card",
    "ameria_card",
    "admin",
  ]);
  assert.deepEqual(resolveBookingAddonPaymentMethods(allEnabled, false), [
    "idram",
    "idbank_card",
    "ameria_card",
  ]);
});

test("admin payment remains available when regular payment methods are disabled", () => {
  assert.deepEqual(
    resolveBookingAddonPaymentMethods(
      { idram: false, idbank_card: false, ameria_card: false },
      true
    ),
    ["admin"]
  );
});
