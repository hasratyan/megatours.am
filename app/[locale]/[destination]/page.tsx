import { Suspense } from "react";
import RouteLoading from "@/components/route-loading";
import { notFound } from "next/navigation";
import DestinationPage from "@/components/destination-page";
import JsonLd from "@/components/json-ld";
import { buildLocalizedMetadata } from "@/lib/metadata";
import { defaultLocale, type Locale, locales } from "@/lib/i18n";
import { destinationSlugs, getDestinationData } from "@/lib/destination-data";
import { buildDestinationStructuredData } from "@/lib/structured-data";
import { destinations, getDestination } from "@/lib/destinations/registry";
import UaeHome from "@/components/destinations/uae-home";
import CyprusHome from "@/components/destinations/cyprus-home";

// Keep the shell/prefetch static while the agent catalogue loads for a real request.
export const ensureStatic = "prefetch";

type PageProps = {
  params: Promise<{
    locale: string;
    destination: string;
  }>;
};

const resolveLocale = (value: string | undefined): Locale =>
  locales.includes(value as Locale) ? (value as Locale) : defaultLocale;

export function generateStaticParams() {
  return locales.flatMap((locale) => [...destinationSlugs, ...destinations.map((entry) => entry.id)].map((destination) => ({ locale, destination })));
}

export async function generateMetadata({ params }: PageProps) {
  const { locale, destination } = await params;
  const resolvedLocale = resolveLocale(locale);
  const platformDestination = getDestination(destination);
  if (platformDestination) return buildLocalizedMetadata({ locale: resolvedLocale, title: `MEGATOURS | ${platformDestination.name[resolvedLocale]}`, description: platformDestination.description[resolvedLocale], path: `/${destination}`, imagePath: platformDestination.image });
  const data = getDestinationData(destination);

  if (!data) {
    return buildLocalizedMetadata({
      locale: resolvedLocale,
      title: "MEGATOURS",
      description: undefined,
      path: `/${destination}`,
    });
  }

  return buildLocalizedMetadata({
    locale: resolvedLocale,
    title: `MEGATOURS | ${data.name[resolvedLocale]}`,
    description: data.heroSummary[resolvedLocale],
    path: `/${destination}`,
    imagePath: data.heroImage,
  });
}

export default function DestinationRoute({ params }: PageProps) {
  return <Suspense fallback={<RouteLoading />}><DestinationContent params={params} /></Suspense>;
}

async function DestinationContent({ params }: PageProps) {
  const { locale, destination } = await params;
  const resolvedLocale = resolveLocale(locale);
  if (destination === "uae") return <UaeHome locale={resolvedLocale} />;
  if (destination === "cyprus") return <CyprusHome locale={resolvedLocale} />;
  const data = getDestinationData(destination);

  if (!data) {
    notFound();
  }

  return (
    <>
      <JsonLd
        id={`structured-data-destination-${data.slug}`}
        data={buildDestinationStructuredData({ locale: resolvedLocale, destination: data })}
      />
      <DestinationPage locale={resolvedLocale} destination={data} />
    </>
  );
}
