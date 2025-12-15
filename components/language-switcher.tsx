"use client";

import { localeLabels, locales } from "@/lib/i18n";
import { useLanguage } from "./language-provider";

export default function LanguageSwitcher() {
  const { locale, setLocale } = useLanguage();

  return (
    <div className="language-switcher">
      {locales.map((code) => (
        <button
          key={code}
          onClick={() => setLocale(code)}
          className={code === locale ? "active" : ""}
          aria-pressed={locale === code}
        >
          {localeLabels[code]}
        </button>
      ))}
    </div>
  );
}
