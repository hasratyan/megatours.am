import { resolveAoryxMealCode } from "@/lib/aoryx-meals";
import { normalizeAmount, type AmdRates, type DisplayCurrency } from "@/lib/currency";
import type { AoryxHotelSummary } from "@/types/aoryx";

export type MealStartingPrice = { code: string; amount: number; currency: string };

export function summarizeHotelMealPrices(
  hotel: AoryxHotelSummary,
  searchCurrency: string | null,
  selectedMeals: readonly string[],
  amdRates: AmdRates | null,
  displayCurrency: DisplayCurrency
): {
  displayPrice: number | null;
  displayCurrency: string;
  primaryMealCode: string | null;
  mealStartingPrices: MealStartingPrice[];
} {
  const baseCurrency = hotel.currency ?? searchCurrency;
  const mealStartingPrices = (hotel.availableRates ?? []).flatMap((rate) => {
    const code = resolveAoryxMealCode(rate.mealCode);
    if (!code || typeof rate.amount !== "number" || !Number.isFinite(rate.amount)) return [];
    const normalized = normalizeAmount(rate.amount, baseCurrency, amdRates, displayCurrency);
    return [{
      code,
      amount: Math.round(normalized?.amount ?? rate.amount),
      currency: normalized?.currency ?? baseCurrency ?? "USD",
    }];
  }).sort((a, b) => a.amount - b.amount);

  const eligibleRates = selectedMeals.length > 0
    ? mealStartingPrices.filter((rate) => selectedMeals.includes(rate.code))
    : mealStartingPrices;
  const primaryRate = eligibleRates[0] ?? null;
  const fallbackPrice = !primaryRate && selectedMeals.length === 0 && typeof hotel.minPrice === "number" && Number.isFinite(hotel.minPrice)
    ? hotel.minPrice
    : null;
  const normalizedFallback = normalizeAmount(fallbackPrice, baseCurrency, amdRates, displayCurrency);

  return {
    displayPrice: primaryRate?.amount ?? (normalizedFallback ? Math.round(normalizedFallback.amount) : fallbackPrice !== null ? Math.round(fallbackPrice) : null),
    displayCurrency: primaryRate?.currency ?? normalizedFallback?.currency ?? baseCurrency ?? "USD",
    primaryMealCode: primaryRate?.code ?? null,
    mealStartingPrices,
  };
}
