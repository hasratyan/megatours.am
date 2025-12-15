"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Locale, defaultLocale, getTranslations } from "@/lib/i18n";

type LanguageContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: ReturnType<typeof getTranslations>;
};

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = useState<Locale>(() => {
    if (typeof window === "undefined") return defaultLocale;
    const stored = window.localStorage.getItem("aoryx-locale") as Locale | null;
    return stored && ["hy", "en", "ru"].includes(stored) ? stored : defaultLocale;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("aoryx-locale", locale);
  }, [locale]);

  const value = useMemo<LanguageContextValue>(
    () => ({ locale, setLocale, t: getTranslations(locale) }),
    [locale],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error("useLanguage must be used within LanguageProvider");
  }
  return ctx;
}

export function useTranslations() {
  return useLanguage().t;
}
