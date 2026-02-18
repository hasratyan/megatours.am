import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import PackageServiceClient from "@/components/package-service-client";
import { authOptions } from "@/lib/auth";
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
  params: Promise<{ locale: string; service: string }>;
};

const resolveLocale = (value: string | undefined) =>
  locales.includes(value as Locale) ? (value as Locale) : defaultLocale;

const resolveServiceKey = (value: string | undefined): PackageBuilderService | null => {
  const normalized = value?.toLowerCase() ?? "";
  return serviceKeys.includes(normalized as PackageBuilderService)
    ? (normalized as PackageBuilderService)
    : null;
};

export function generateStaticParams() {
  return serviceKeys.map((service) => ({ service }));
}

export async function generateMetadata({ params }: PageProps) {
  const { locale, service } = await params;
  const resolvedLocale = resolveLocale(locale);
  const t = getTranslations(resolvedLocale);
  const serviceKey = resolveServiceKey(service);
  const pageCopy = serviceKey ? t.packageBuilder.pages[serviceKey] : null;
  return buildLocalizedMetadata({
    locale: resolvedLocale,
    title: pageCopy?.title ?? t.packageBuilder.title,
    description: pageCopy?.body ?? t.packageBuilder.subtitle,
    path: serviceKey ? `/services/${serviceKey}` : "/services",
  });
}

export default async function ServicePage({ params }: PageProps) {
  const { locale, service } = await params;
  const resolvedLocale = resolveLocale(locale);
  const t = getTranslations(resolvedLocale);
  const serviceKey = resolveServiceKey(service);

  if (!serviceKey) {
    notFound();
  }

  const pageCopy = t.packageBuilder.pages[serviceKey];
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    const callbackUrl = encodeURIComponent(`/${resolvedLocale}/services/${serviceKey}`);
    const relatedServices = serviceKeys.filter((entry) => entry !== serviceKey);

    return (
      <main className="service-builder service-landing">
        <div className="container">
          <div className="header">
            <h1>{pageCopy.title}</h1>
            <p>{pageCopy.body}</p>
          </div>

          <div className="panel service-landing__panel">
            <p>{pageCopy.note}</p>
            <div className="service-landing__actions">
              <Link href={`/${resolvedLocale}/services/hotel`} className="service-builder__cta">
                {t.packageBuilder.pages.hotel.cta}
              </Link>
              <Link
                href={`/api/auth/signin?callbackUrl=${callbackUrl}`}
                className="service-builder__cta"
              >
                {t.profile.signIn.cta}
              </Link>
            </div>
          </div>

          <section className="service-landing__more">
            <h2>{t.packageBuilder.subtitle}</h2>
            <div className="service-landing__grid">
              {relatedServices.map((entry) => {
                const copy = t.packageBuilder.pages[entry];
                return (
                  <article key={entry}>
                    <h3>{copy.title}</h3>
                    <p>{copy.body}</p>
                    <Link
                      href={`/${resolvedLocale}/services/${entry}`}
                      className="service-builder__cta"
                    >
                      {copy.cta}
                    </Link>
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      </main>
    );
  }

  return <PackageServiceClient serviceKey={serviceKey} />;
}
