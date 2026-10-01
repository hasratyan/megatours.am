import { applyMarkup } from "@/lib/pricing-utils";

type RatePrice = { net?: number | null; gross?: number | null };

// Net includes Aoryx's returned taxes. Use the same payable amount throughout
// search, room selection and repricing; retain raw supplier price fields.
export function getAoryxRateAmount(price?: RatePrice | null): number | null {
  for (const amount of [price?.net, price?.gross]) {
    if (typeof amount === "number" && Number.isFinite(amount) && amount > 0) return amount;
  }
  return null;
}

export function withAoryxDisplayPrice<T extends { price?: RatePrice | null; totalPrice?: number | null }>(
  room: T,
  markup?: number | null
): T & { totalPrice: number | null; displayTotalPrice: number | null } {
  const totalPrice = getAoryxRateAmount(room.price) ?? room.totalPrice ?? null;
  return { ...room, totalPrice, displayTotalPrice: applyMarkup(totalPrice, markup) };
}
