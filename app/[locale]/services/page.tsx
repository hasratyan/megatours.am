import Link from "next/link";
import { buildLocalizedMetadata } from "@/lib/metadata";
import { defaultLocale, getTranslations, Locale, locales } from "@/lib/i18n";
import type { PackageBuilderService } from "@/lib/package-builder-state";

const serviceKeys: PackageBuilderService[] = [
  "hotel",
  "flight",
  "transfer",
  "excursion",
  "insurance",
];

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
    title: `${t.packageBuilder.title} | MEGATOURS`,
    description: t.services.title,
    path: "/services",
  });
}

export default async function ServicesHubPage({ params }: PageProps) {
  const { locale } = await params;
  const resolvedLocale = resolveLocale(locale);
  const t = getTranslations(resolvedLocale);

  return (
    <main className="service-builder service-hub">
      <div className="container">
        <div className="header">
          <h1>{t.packageBuilder.title}</h1>
          <p>{t.services.title}</p>
        </div>
        <div className="service-hub__grid">
          {serviceKeys.map((serviceKey) => {
            const pageCopy = t.packageBuilder.pages[serviceKey];
            return (
              <article key={serviceKey} className="service-hub__card">
                <h2>{pageCopy.title}</h2>
                <p>{pageCopy.body}</p>
                <small>{pageCopy.note}</small>
                <Link
                  href={`/${resolvedLocale}/services/${serviceKey}`}
                  className="service-builder__cta"
                >
                  {pageCopy.cta}
                </Link>
              </article>
            );
          })}
        </div>
      </div>
    </main>
  );
}
