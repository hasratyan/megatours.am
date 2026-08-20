import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's built-in TypeScript test runner requires the source extension.
import { isInsuranceAddonCheckoutReady } from "../lib/insurance-addon-checkout.ts";

test("insurance add-on checkout opens only after a successful priced quote", () => {
  assert.equal(
    isInsuranceAddonCheckoutReady({
      hasCheckoutTarget: true,
      selected: true,
      quoteLoading: false,
      quoteError: null,
      price: 6000,
    }),
    true
  );
});

test("insurance add-on checkout stays closed before selection and while quoting", () => {
  assert.equal(
    isInsuranceAddonCheckoutReady({
      hasCheckoutTarget: true,
      selected: false,
      quoteLoading: false,
      price: null,
    }),
    false
  );
  assert.equal(
    isInsuranceAddonCheckoutReady({
      hasCheckoutTarget: true,
      selected: true,
      quoteLoading: true,
      price: 6000,
    }),
    false
  );
});

test("insurance add-on checkout stays closed on quote errors or missing booking context", () => {
  assert.equal(
    isInsuranceAddonCheckoutReady({
      hasCheckoutTarget: true,
      selected: true,
      quoteLoading: false,
      quoteError: "Quote failed",
      price: 6000,
    }),
    false
  );
  assert.equal(
    isInsuranceAddonCheckoutReady({
      hasCheckoutTarget: false,
      selected: true,
      quoteLoading: false,
      price: 6000,
    }),
    false
  );
});
