"use client";

import { createContext, useCallback, useContext, useEffect, useMemo } from "react";
import type { Route } from "next";
import { usePathname, useRouter } from "next/navigation";
import { type Locale, type Translation, locales } from "@/lib/i18n";

type LanguageContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translation;
};

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

type LanguageProviderProps = {
  children: React.ReactNode;
  initialLocale: Locale;
  translations: Translation;
};

export function LanguageProvider({ children, initialLocale: locale, translations }: LanguageProviderProps) {
  const pathname = usePathname();
  const router = useRouter();

  const setLocale = useCallback((newLocale: Locale) => {
    // Set cookie for proxy to use on next navigation
    document.cookie = `megatours-locale=${newLocale};path=/;max-age=31536000`;
    
    // Navigate to the new locale path
    const segments = pathname.split("/");
    // Check if first segment is a locale
    if (segments[1] && locales.includes(segments[1] as Locale)) {
      segments[1] = newLocale;
    } else {
      segments.splice(1, 0, newLocale);
    }
    
    const queryString = typeof window !== "undefined" ? window.location.search : "";
    const newPath = segments.join("/") || `/${newLocale}`;
    const destination = `${newPath}${queryString}` as Route;
    
    router.push(destination);
  }, [pathname, router]);

  // Update document lang attribute when locale changes
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<LanguageContextValue>(
    () => ({ locale, setLocale, t: translations }),
    [locale, setLocale, translations],
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
