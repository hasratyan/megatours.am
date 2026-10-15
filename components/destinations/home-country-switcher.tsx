"use client";
import Link from "next/link";
import type { Route } from "next";
import type { Locale } from "@/lib/i18n";
import { destinations, type DestinationId } from "@/lib/destinations/registry";
import { useCurrency } from "@/components/currency-provider";
import { withDisplayCurrencyParam } from "@/lib/currency";
import styles from "./home-country-switcher.module.css";

export default function HomeCountrySwitcher({ locale, destination }: { locale: Locale; destination: DestinationId }) {
  const { currency } = useCurrency();
  return <nav className={styles.switcher} aria-label={{ hy: "Ընտրեք երկիրը", en: "Choose destination country", ru: "Выберите страну" }[locale]}>
    {destinations.map((country) => <Link key={country.id} className={`${styles.country}${country.id === destination ? ` ${styles.active}` : ""}`} aria-current={country.id === destination ? "page" : undefined}
      href={withDisplayCurrencyParam(`/${locale}/${country.id}`, currency) as Route}
      onClick={() => { document.cookie = `megatours-destination=${country.id};path=/;max-age=31536000;SameSite=Lax`; }}>
      <span aria-hidden="true">{String.fromCodePoint(...country.countryCode.toUpperCase().split("").map((letter) => 127397 + letter.charCodeAt(0)))}</span>{country.name[locale]}
    </Link>)}
  </nav>;
}
