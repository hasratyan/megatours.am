import { notFound } from "next/navigation";
import DestinationPage from "@/components/destination-page";
import { buildLocalizedMetadata } from "@/lib/metadata";
import { defaultLocale, type Locale, locales } from "@/lib/i18n";
import { destinationSlugs, getDestinationData } from "@/lib/destination-data";

type PageProps = {
  params: Promise<{
    locale: string;
    destination: string;
  }>;
};

const resolveLocale = (value: string | undefined): Locale =>
  locales.includes(value as Locale) ? (value as Locale) : defaultLocale;

export function generateStaticParams() {
  return locales.flatMap((locale) => destinationSlugs.map((destination) => ({ locale, destination })));
}

export async function generateMetadata({ params }: PageProps) {
  const { locale, destination } = await params;
  const resolvedLocale = resolveLocale(locale);
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

export default async function DestinationRoute({ params }: PageProps) {
  const { locale, destination } = await params;
  const resolvedLocale = resolveLocale(locale);
  const data = getDestinationData(destination);

  if (!data) {
    notFound();
  }

  return <DestinationPage locale={resolvedLocale} destination={data} />;
}
