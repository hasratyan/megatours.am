import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import PackageServiceClient from "@/components/package-service-client";
import { authOptions } from "@/lib/auth";
import { buildLocalizedMetadata } from "@/lib/metadata";
import { defaultLocale, getTranslations, Locale, locales } from "@/lib/i18n";
import { DEFAULT_SERVICE_FLAGS, type PackageBuilderService } from "@/lib/package-builder-state";
import { getServiceFlags } from "@/lib/service-flags";

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
  const serviceFlags = await getServiceFlags().catch(() => DEFAULT_SERVICE_FLAGS);
  const isServiceEnabled = serviceFlags[serviceKey] !== false;
  if (!isServiceEnabled) {
    return (
      <main className="service-builder service-landing">
        <div className="container">
          <div className="header">
            <h1>{pageCopy.title}</h1>
            <p>{pageCopy.body}</p>
          </div>
          <div className="panel service-landing__panel is-disabled">
            <p>{t.packageBuilder.serviceDisabled.replace("{service}", pageCopy.title)}</p>
            <div className="service-landing__actions">
              <Link href={`/${resolvedLocale}/services`} className="service-builder__cta">
                {t.packageBuilder.viewService}
              </Link>
              <Link href={`/${resolvedLocale}/services/hotel`} className="service-builder__cta">
                {t.packageBuilder.pages.hotel.cta}
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

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
                const isEnabled = serviceFlags[entry] !== false;
                return (
                  <article key={entry} className={isEnabled ? "" : "is-disabled"}>
                    <h3>{copy.title}</h3>
                    <p>{copy.body}</p>
                    {isEnabled ? (
                      <Link
                        href={`/${resolvedLocale}/services/${entry}`}
                        className="service-builder__cta"
                      >
                        {copy.cta}
                      </Link>
                    ) : (
                      <span className="service-builder__cta is-disabled" aria-disabled="true">
                        {t.packageBuilder.disabledTag}
                      </span>
                    )}
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
