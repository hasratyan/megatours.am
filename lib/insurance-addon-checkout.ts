export const isInsuranceAddonCheckoutReady = (input: {
  hasCheckoutTarget: boolean;
  selected: boolean;
  quoteLoading: boolean;
  quoteError?: string | null;
  price?: number | null;
}) =>
  input.hasCheckoutTarget &&
  input.selected &&
  !input.quoteLoading &&
  !(typeof input.quoteError === "string" && input.quoteError.trim().length > 0) &&
  typeof input.price === "number" &&
  Number.isFinite(input.price) &&
  input.price > 0;
