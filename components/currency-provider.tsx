"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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

const CURRENCY_URL_CHANGE_EVENT = "megatours:currency-url-change";

const readCurrencyFromUrl = () => {
  if (typeof window === "undefined") return DEFAULT_DISPLAY_CURRENCY;
  return resolveDisplayCurrency(new URLSearchParams(window.location.search).get(DISPLAY_CURRENCY_QUERY_PARAM));
};

const hasCurrencyParam = () => {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).has(DISPLAY_CURRENCY_QUERY_PARAM);
};

const writeCurrencyToUrl = (currency: DisplayCurrency) => {
  if (typeof window === "undefined") return;
  const resolved = resolveDisplayCurrency(currency);
  const url = new URL(window.location.href);
  if (resolved === DEFAULT_DISPLAY_CURRENCY) {
    url.searchParams.delete(DISPLAY_CURRENCY_QUERY_PARAM);
  } else {
    url.searchParams.set(DISPLAY_CURRENCY_QUERY_PARAM, resolved);
  }

  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl !== currentUrl) {
    window.history.replaceState(window.history.state, "", nextUrl);
  }
};

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrencyState] = useState<DisplayCurrency>(DEFAULT_DISPLAY_CURRENCY);
  const currencyRef = useRef<DisplayCurrency>(DEFAULT_DISPLAY_CURRENCY);

  const commitCurrency = useCallback((nextCurrency: DisplayCurrency) => {
    currencyRef.current = nextCurrency;
    setCurrencyState((current) => (current === nextCurrency ? current : nextCurrency));
  }, []);

  useEffect(() => {
    const notifyUrlChange = () => window.dispatchEvent(new Event(CURRENCY_URL_CHANGE_EVENT));
    const originalPushState = window.history.pushState;
    const originalReplaceState = window.history.replaceState;

    window.history.pushState = function patchedPushState(
      this: History,
      ...args: Parameters<History["pushState"]>
    ) {
      const result = originalPushState.apply(this, args);
      notifyUrlChange();
      return result;
    } as History["pushState"];

    window.history.replaceState = function patchedReplaceState(
      this: History,
      ...args: Parameters<History["replaceState"]>
    ) {
      const result = originalReplaceState.apply(this, args);
      notifyUrlChange();
      return result;
    } as History["replaceState"];

    const syncFromUrl = () => {
      if (hasCurrencyParam()) {
        const nextCurrency = readCurrencyFromUrl();
        commitCurrency(nextCurrency);
        if (nextCurrency === DEFAULT_DISPLAY_CURRENCY) {
          writeCurrencyToUrl(nextCurrency);
        }
        return;
      }

      const currentCurrency = currencyRef.current;
      if (currentCurrency !== DEFAULT_DISPLAY_CURRENCY) {
        writeCurrencyToUrl(currentCurrency);
        return;
      }
      commitCurrency(DEFAULT_DISPLAY_CURRENCY);
    };

    syncFromUrl();
    window.addEventListener("popstate", syncFromUrl);
    window.addEventListener(CURRENCY_URL_CHANGE_EVENT, syncFromUrl);
    return () => {
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
      window.removeEventListener("popstate", syncFromUrl);
      window.removeEventListener(CURRENCY_URL_CHANGE_EVENT, syncFromUrl);
    };
  }, [commitCurrency]);

  const setCurrency = useCallback((nextCurrency: DisplayCurrency) => {
    const resolved = resolveDisplayCurrency(nextCurrency);
    commitCurrency(resolved);
    writeCurrencyToUrl(resolved);
  }, [commitCurrency]);

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
