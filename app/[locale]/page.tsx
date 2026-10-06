import { Suspense } from "react";
import RouteLoading from "@/components/route-loading";
import { getTranslations } from "@/lib/i18n-server";
import Home from "./home";
import JsonLd from "@/components/json-ld";
import { buildLocalizedMetadata } from "@/lib/metadata";
import { defaultLocale, Locale, locales } from "@/lib/i18n";
import { getFeaturedHotelCards, type FeaturedHotelCard } from "@/lib/featured-hotels";
import { buildHomeStructuredData } from "@/lib/structured-data";

export const ensureStatic = "navigation";

type PageProps = {
  params: Promise<{ locale: string }>;
};

const resolveLocale = (value: string | undefined) =>
  locales.includes(value as Locale) ? (value as Locale) : defaultLocale;


export async function generateMetadata({ params }: PageProps) {
  const { locale } = await params;
  const resolvedLocale = resolveLocale(locale);
  const t = getTranslations(resolvedLocale);
  return buildLocalizedMetadata({
    locale: resolvedLocale,
    title: `MEGATOURS | ${t.hero.title}`,
    description: t.hero.subtitle,
  });
}

export default function HomePage({ params }: PageProps) {
  return <Suspense fallback={<RouteLoading />}><HomeContent params={params} /></Suspense>;
}

async function HomeContent({ params }: PageProps) {
  const { locale } = await params;
  const resolvedLocale = resolveLocale(locale);
  const t = getTranslations(resolvedLocale);
  let featuredHotels: FeaturedHotelCard[] = [];

  try {
    featuredHotels = await getFeaturedHotelCards(resolvedLocale);
  } catch (error) {
    console.error("[Home] Failed to load featured hotels", error);
  }

  return (
    <>
      <JsonLd
        id="structured-data-home"
        data={buildHomeStructuredData({
          locale: resolvedLocale,
          title: `MEGATOURS | ${t.hero.title}`,
          description: t.hero.subtitle,
          path: `/${resolvedLocale}`,
          faqs: t.faq.items,
          featuredHotels,
        })}
      />
      <Home locale={resolvedLocale} featuredHotels={featuredHotels} />
    </>
  );
}
