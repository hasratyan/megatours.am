import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's built-in TypeScript test runner requires the source extension.
import { BookingServiceRemovalError, parseBookingServiceRemovalKeys, removeBookingServices } from "../lib/admin-booking-service-removal.ts";

type RemovalPayload = Parameters<typeof removeBookingServices>[0]["payload"];

const payloadWithServices = () =>
  ({
    rooms: [],
    transferSelection: { totalPrice: 20 },
    excursions: { totalAmount: 10, selections: [{ id: "tour-1" }] },
    insurance: { planId: "efes-travel", price: 6000, currency: "AMD" },
    airTickets: { price: 100, currency: "USD" },
  }) as unknown as RemovalPayload;

test("booking service removal keys include insurance and ignore unsupported values", () => {
  assert.deepEqual(
    parseBookingServiceRemovalKeys(["insurance", "transfer", "insurance", "hotel"]),
    ["insurance", "transfer"]
  );
});

test("failed insurance can be removed and its failure metadata is marked for clearing", () => {
  const original = payloadWithServices();
  const result = removeBookingServices({
    payload: original,
    serviceKeys: ["insurance", "transfer"],
    insuranceStatus: "failed",
  });

  assert.equal(result.payload.insurance, null);
  assert.equal(result.payload.transferSelection, null);
  assert.ok(original.insurance);
  assert.equal(result.clearInsuranceMetadata, true);
  assert.deepEqual(result.removedServices, ["insurance", "transfer"]);
});

test("issued insurance cannot be removed locally", () => {
  assert.throws(
    () =>
      removeBookingServices({
        payload: payloadWithServices(),
        serviceKeys: ["insurance"],
        insuranceStatus: "confirmed",
      }),
    (error: unknown) =>
      error instanceof BookingServiceRemovalError &&
      error.code === "insurance_policy_confirmed"
  );
});

test("partially issued insurance cannot be removed even when overall status failed", () => {
  assert.throws(
    () =>
      removeBookingServices({
        payload: payloadWithServices(),
        serviceKeys: ["insurance"],
        insuranceStatus: "failed",
        insuranceHasIssuedPolicy: true,
      }),
    (error: unknown) =>
      error instanceof BookingServiceRemovalError &&
      error.code === "insurance_policy_confirmed"
  );
});

test("unresolved insurance cannot be removed locally", () => {
  assert.throws(
    () =>
      removeBookingServices({
        payload: payloadWithServices(),
        serviceKeys: ["insurance"],
        insuranceStatus: "pending",
      }),
    (error: unknown) =>
      error instanceof BookingServiceRemovalError && error.code === "insurance_policy_pending"
  );
});

test("stale removal requests cannot remove a service that is no longer attached", () => {
  const payload = payloadWithServices();
  payload.airTickets = null;

  assert.throws(
    () =>
      removeBookingServices({
        payload,
        serviceKeys: ["flight"],
        insuranceStatus: "failed",
      }),
    (error: unknown) =>
      error instanceof BookingServiceRemovalError && error.code === "service_not_attached"
  );
});
