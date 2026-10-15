import { Suspense } from "react";
import RouteLoading from "@/components/route-loading";
import UaeHome from "@/components/destinations/uae-home";
import { buildLocalizedMetadata } from "@/lib/metadata";
import { defaultLocale, type Locale, locales } from "@/lib/i18n";
import { getTranslations } from "@/lib/i18n-server";

export const ensureStatic = "navigation";
type PageProps = { params: Promise<{ locale: string }> };
const resolveLocale = (value: string) => locales.includes(value as Locale) ? value as Locale : defaultLocale;

export async function generateMetadata({ params }: PageProps) {
  const locale = resolveLocale((await params).locale);
  const t = getTranslations(locale);
  return buildLocalizedMetadata({ locale, title: `MEGATOURS | ${t.hero.title}`, description: t.hero.subtitle });
}
export default function HomePage({ params }: PageProps) {
  return <Suspense fallback={<RouteLoading />}><HomeContent params={params} /></Suspense>;
}
async function HomeContent({ params }: PageProps) {
  return <UaeHome locale={resolveLocale((await params).locale)} />;
}
