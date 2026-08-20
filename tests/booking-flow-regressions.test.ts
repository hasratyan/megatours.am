import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's built-in TypeScript test runner requires the source extension.
import { hasManualGuestNameInput, syncLeadGuestWithContact } from "../lib/checkout-guest-sync.ts";
// @ts-expect-error Node's built-in TypeScript test runner requires the source extension.
import { formatEfesPolicyCreationDate, hasIssuedEfesPolicy, resolveInsuranceIssuance } from "../lib/insurance-policy-status.ts";
// @ts-expect-error Node's built-in TypeScript test runner requires the source extension.
import { resolveBookingAddonPaymentServiceOutcome } from "../lib/booking-addon-payment-outcome.ts";

const roomGuests = (firstName: string, lastName: string) => [
  {
    roomIdentifier: 1,
    guests: [
      {
        id: "room-1-adult-1",
        type: "Adult" as const,
        age: 30,
        firstName,
        lastName,
      },
    ],
  },
];

test("contact edits update the account-default lead guest", () => {
  const synced = syncLeadGuestWithContact(
    roomGuests("MEGATOURS", "Support"),
    { firstName: "MEGATOURS", lastName: "Support" },
    { firstName: "Vahe", lastName: "Hasratyan" }
  );

  assert.equal(synced[0]?.guests[0]?.firstName, "Vahe");
  assert.equal(synced[0]?.guests[0]?.lastName, "Hasratyan");
});

test("a manually edited lead guest is not overwritten by contact changes", () => {
  const synced = syncLeadGuestWithContact(
    roomGuests("Vahe", "Hasratyan"),
    { firstName: "MEGATOURS", lastName: "Support" },
    { firstName: "Another", lastName: "Contact" }
  );

  assert.equal(synced[0]?.guests[0]?.firstName, "Vahe");
  assert.equal(synced[0]?.guests[0]?.lastName, "Hasratyan");
  assert.equal(
    hasManualGuestNameInput(synced, {
      firstName: "Another",
      lastName: "Contact",
    }),
    true
  );
});

test("EFES error-shaped policy responses are failures, not confirmations", () => {
  const result = resolveInsuranceIssuance({
    insuranceSelected: true,
    insurancePolicies: [
      {
        travelerId: "room-1-adult-1",
        response: {
          is_error: 1,
          error_code: 4,
          error_msg: "Validation error - 0169",
          result: "",
        },
      },
    ],
  });

  assert.equal(result.status, "failed");
  assert.match(result.errorMessage ?? "", /0169/);
});

test("EFES policy responses require a returned policy number", () => {
  const confirmed = resolveInsuranceIssuance({
    insuranceSelected: true,
    insurancePolicies: [
      {
        travelerId: "room-1-adult-1",
        response: {
          is_error: 0,
          error_code: 0,
          d_error_code: 0,
          result: "POLICY-123",
        },
      },
    ],
  });
  const missingNumber = resolveInsuranceIssuance({
    insuranceSelected: true,
    insurancePolicies: [
      {
        travelerId: "room-1-adult-1",
        response: {
          is_error: 0,
          error_code: 0,
          result: "",
        },
      },
    ],
  });

  assert.equal(confirmed.status, "confirmed");
  assert.equal(missingNumber.status, "failed");
});

test("mixed EFES results retain knowledge of any issued policy", () => {
  const policies = [
    {
      response: {
        is_error: 0,
        error_code: 0,
        d_error_code: 0,
        result: "POLICY-123",
      },
    },
    {
      response: {
        is_error: 1,
        error_code: 4,
        result: "",
      },
    },
  ];

  assert.equal(resolveInsuranceIssuance({ insuranceSelected: true, insurancePolicies: policies }).status, "failed");
  assert.equal(hasIssuedEfesPolicy(policies), true);
});

test("EFES creation date uses Yerevan's calendar day after local midnight", () => {
  assert.equal(
    formatEfesPolicyCreationDate(new Date("2026-08-19T20:27:55.731Z")),
    "2026-08-20"
  );
});

test("failed EFES insurance is not presented as an applied add-on service", () => {
  const outcome = resolveBookingAddonPaymentServiceOutcome({
    appliedServices: ["insurance", "transfer"],
    insuranceStatus: "failed",
  });

  assert.deepEqual(outcome.appliedServices, ["transfer"]);
  assert.deepEqual(outcome.failedServices, ["insurance"]);
});

test("confirmed EFES retry restores insurance to applied add-on services", () => {
  const outcome = resolveBookingAddonPaymentServiceOutcome({
    appliedServices: ["transfer"],
    failedServices: ["insurance"],
    insuranceStatus: "confirmed",
  });

  assert.deepEqual(outcome.appliedServices, ["transfer", "insurance"]);
  assert.deepEqual(outcome.failedServices, []);
});

test("insurance status does not alter an unrelated latest add-on payment", () => {
  const outcome = resolveBookingAddonPaymentServiceOutcome({
    appliedServices: ["transfer"],
    insuranceStatus: "failed",
  });

  assert.deepEqual(outcome.appliedServices, ["transfer"]);
  assert.deepEqual(outcome.failedServices, []);
});
