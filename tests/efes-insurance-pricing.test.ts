import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's built-in TypeScript test runner requires the source extension.
import { applyEfesInsuranceQuote, buildEfesInsuranceQuoteRequest, calculateEfesInsuranceAge } from "../lib/efes-insurance-pricing.ts";

test("EFES age is calculated on the insurance start date", () => {
  assert.equal(calculateEfesInsuranceAge("1963-12-08", "2026-09-20"), 62);
  assert.equal(calculateEfesInsuranceAge("1961-05-09", "2026-09-20"), 65);
});

test("EFES quote request uses each traveler's birth date instead of the adult placeholder", () => {
  const request = buildEfesInsuranceQuoteRequest({
    startDate: "2026-09-20",
    endDate: "2026-10-02",
    days: 13,
    territoryCode: "whole_world_exc_uk_sch_us_ca_au_jp",
    riskAmount: 15000,
    riskCurrency: "EUR",
    riskLabel: "STANDARD",
    travelers: [
      { id: "room-1-adult-1", firstName: "A", lastName: "A", birthDate: "1963-12-08" },
      { id: "room-1-adult-2", firstName: "B", lastName: "B", birthDate: "1961-05-09" },
    ],
  });

  assert.deepEqual(request.travelers.map((traveler) => traveler.age), [62, 65]);
  assert.equal(request.days, 13);
});

test("fresh EFES quote replaces stale per-traveler and total premiums", () => {
  const insurance = applyEfesInsuranceQuote(
    {
      planId: "efes-travel",
      provider: "efes",
      price: 7800,
      currency: "AMD",
      travelers: [
        { id: "room-1-adult-1", firstName: "A", lastName: "A", premium: 3900, policyPremium: 3900 },
        { id: "room-1-adult-2", firstName: "B", lastName: "B", premium: 3900, policyPremium: 3900 },
      ],
    },
    {
      totalPremium: 11700,
      currency: "AMD",
      premiums: [
        { travelerId: "room-1-adult-1", premium: 3900 },
        { travelerId: "room-1-adult-2", premium: 7800 },
      ],
    }
  );

  assert.equal(insurance.price, 11700);
  assert.deepEqual(insurance.travelers?.map((traveler) => traveler.premium), [3900, 7800]);
  assert.deepEqual(insurance.travelers?.map((traveler) => traveler.policyPremium), [3900, 7800]);
});
