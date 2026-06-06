"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  DEFAULT_DISPLAY_CURRENCY,
  DISPLAY_CURRENCY_QUERY_PARAM,
  type DisplayCurrency,
  resolveDisplayCurrency,
} from "@/lib/currency";

type CurrencyContextValue = {
  currency: DisplayCurrency;
  setCurrency: (currency: DisplayCurrency) => void;
};

const CurrencyContext = createContext<CurrencyContextValue | undefined>(undefined);

const readCurrencyFromUrl = () => {
  if (typeof window === "undefined") return DEFAULT_DISPLAY_CURRENCY;
  return resolveDisplayCurrency(new URLSearchParams(window.location.search).get(DISPLAY_CURRENCY_QUERY_PARAM));
};

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrencyState] = useState<DisplayCurrency>(DEFAULT_DISPLAY_CURRENCY);

  useEffect(() => {
    const syncFromUrl = () => setCurrencyState(readCurrencyFromUrl());
    syncFromUrl();
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, []);

  const setCurrency = useCallback((nextCurrency: DisplayCurrency) => {
    const resolved = resolveDisplayCurrency(nextCurrency);
    setCurrencyState(resolved);

    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (resolved === DEFAULT_DISPLAY_CURRENCY) {
      url.searchParams.delete(DISPLAY_CURRENCY_QUERY_PARAM);
    } else {
      url.searchParams.set(DISPLAY_CURRENCY_QUERY_PARAM, resolved);
    }
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  const value = useMemo(() => ({ currency, setCurrency }), [currency, setCurrency]);

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

export function useCurrency() {
  const ctx = useContext(CurrencyContext);
  if (!ctx) {
    throw new Error("useCurrency must be used within CurrencyProvider");
  }
  return ctx;
}
