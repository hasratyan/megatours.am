import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's built-in TypeScript test runner requires the source extension.
import { assertCheckoutInsuranceNames, assertEfesInsuranceNames, isArmenianInsuranceName, isEnglishInsuranceName, normalizeInsuranceTravelerNames } from "../lib/insurance-traveler-names.ts";

const names = {
  firstName: "Անի",
  lastName: "Պետրոսյան",
  firstNameEn: "Ani",
  lastNameEn: "Petrosyan",
};

test("insurance serialization preserves Armenian names when English names are also provided", () => {
  assert.deepEqual(normalizeInsuranceTravelerNames({ ...names, firstName: " Անի " }), names);
  assert.equal(normalizeInsuranceTravelerNames({ ...names, firstName: "" }).firstName, "");
  assert.equal(normalizeInsuranceTravelerNames({ ...names, firstNameEn: "" }).firstNameEn, "");
});

test("name validation accepts Armenian and Latin compounds in their own fields", () => {
  for (const name of ["Անի", "Աննա-Մարիա", "Տեր Պետրոսյան", "Եվա", "Սևակ"]) {
    assert.equal(isArmenianInsuranceName(name), true, name);
  }
  for (const name of ["Ani", "Anna-Maria", "Ter Petrosyan", "O'Neil"]) {
    assert.equal(isEnglishInsuranceName(name), true, name);
  }
  for (const name of ["", "  ", "--", "123", "Ani", "Անi", "Анна"]) {
    assert.equal(isArmenianInsuranceName(name), false, name);
  }
  assert.equal(isEnglishInsuranceName("Անի"), false);
});

test("checkout rejects the historical English-overwrites-Armenian payload before payment", () => {
  const insurance = { provider: "efes", travelers: [{ ...names, firstName: "Ani", lastName: "Petrosyan" }] };
  for (const body of [
    { insurance },
    { insurance: { travelers: insurance.travelers } },
    { flow: "booking_addons", addonServices: { insurance } },
    { flow: "booking_addons", insurance },
  ]) {
    assert.throws(() => assertCheckoutInsuranceNames(body), /traveler 1.*Armenian/);
  }
});

test("validation checks every traveler without including private names in errors", () => {
  assert.throws(() => assertEfesInsuranceNames({
    provider: "efes", travelers: [names, { ...names, firstName: "PrivateName" }],
  }), error => error instanceof Error && /traveler 2/.test(error.message) && !error.message.includes("PrivateName"));
  assert.throws(() => assertEfesInsuranceNames({
    provider: "efes", travelers: [{ ...names, firstNameEn: "" }],
  }), /English first and last names/);
});

test("valid insurance and checkouts without EFES are unaffected", () => {
  assert.doesNotThrow(() => assertCheckoutInsuranceNames({ insurance: { provider: "efes", travelers: [names] } }));
  assert.doesNotThrow(() => assertCheckoutInsuranceNames({ flow: "booking_addons", addonServices: { transfer: {} } }));
  assert.doesNotThrow(() => assertEfesInsuranceNames({ provider: "other", travelers: [{ firstName: "Ani" }] }));
});
