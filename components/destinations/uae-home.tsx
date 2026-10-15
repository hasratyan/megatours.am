import Home from "@/app/[locale]/home";
import JsonLd from "@/components/json-ld";
import { getTranslations } from "@/lib/i18n-server";
import { getFeaturedHotelCards, type FeaturedHotelCard } from "@/lib/featured-hotels";
import { buildHomeStructuredData } from "@/lib/structured-data";
import type { Locale } from "@/lib/i18n";

export default async function UaeHome({ locale }: { locale: Locale }) {
  const t = getTranslations(locale);
  let featuredHotels: FeaturedHotelCard[] = [];
  try { featuredHotels = await getFeaturedHotelCards(locale); }
  catch (error) { console.error("[UaeHome] Failed to load featured hotels", error); }
  return <>
    <JsonLd id="structured-data-uae-home" data={buildHomeStructuredData({ locale, title: `MEGATOURS | ${t.hero.title}`, description: t.hero.subtitle, path: `/${locale}/uae`, faqs: t.faq.items, featuredHotels })} />
    <Home locale={locale} featuredHotels={featuredHotels} />
  </>;
}
