"use client";

import { useCurrency } from "@/components/currency-provider";
import { useAmdRates } from "@/lib/use-amd-rates";
import { normalizeAmount } from "@/lib/currency";
import type { Locale } from "@/lib/i18n";

/** Display preferences never change the supplier quote or payable currency. */
export function useDestinationMoney(locale: Locale) {
  const { currency: displayCurrency } = useCurrency();
  const { rates } = useAmdRates();
  return (amount: number, currency: string) => {
    const format = (value: number, code: string) => new Intl.NumberFormat(locale, { style: "currency", currency: code }).format(value);
    const original = format(amount, currency);
    const display = normalizeAmount(amount, currency, rates, displayCurrency);
    return display && display.currency !== currency ? `≈ ${format(display.amount, display.currency)} (${original})` : original;
  };
}
