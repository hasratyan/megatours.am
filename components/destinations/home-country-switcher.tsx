"use client";
import { startTransition, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import GooeyNav from "@/components/GooeyNav";
import type { Locale } from "@/lib/i18n";
import { destinations, type DestinationId } from "@/lib/destinations/registry";
import { useCurrency } from "@/components/currency-provider";
import { withDisplayCurrencyParam } from "@/lib/currency";

export default function HomeCountrySwitcher({ locale, destination }: { locale: Locale; destination: DestinationId }) {
  const { currency } = useCurrency();
  const router = useRouter();
  const navigationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pending, setPending] = useState<{ from: DestinationId; to: DestinationId } | null>(null);
  const selectedDestination = pending?.from === destination ? pending.to : destination;
  const items = destinations.map((country) => ({
    label: country.name[locale],
    href: withDisplayCurrencyParam(`/${locale}/${country.id}`, currency),
    icon: String.fromCodePoint(...country.countryCode.toUpperCase().split("").map((letter) => 127397 + letter.charCodeAt(0))),
  }));

  useEffect(() => () => {
    if (navigationTimer.current) clearTimeout(navigationTimer.current);
  }, []);

  return (
    <GooeyNav
      items={items}
      activeIndex={destinations.findIndex((country) => country.id === selectedDestination)}
      ariaLabel={{ hy: "Ընտրեք երկիրը", en: "Choose destination country", ru: "Выберите страну" }[locale]}
      className="home-country-switcher"
      color="#bce5dc"
      activeTextColor="#142a37"
      animationTime={500}
      timeVariance={120}
      particleCount={15}
      spread={20}
      onChange={(index) => setPending({ from: destination, to: destinations[index].id })}
      onNavigate={(event, index, item) => {
        event.preventDefault();
        if (navigationTimer.current) clearTimeout(navigationTimer.current);
        const country = destinations[index];
        if (country.id === destination) {
          setPending(null);
          return;
        }
        const navigate = () => {
          navigationTimer.current = null;
          document.cookie = `megatours-destination=${country.id};path=/;max-age=31536000;SameSite=Lax`;
          startTransition(() => {
            setPending(null);
            router.push(item.href as Route);
          });
        };
        // Let the pill travel before the route replaces the homepage.
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) navigate();
        else navigationTimer.current = setTimeout(navigate, 420);
      }}
    />
  );
}
