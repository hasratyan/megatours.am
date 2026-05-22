import * as React from "react";
import Header from "@/components/header";
import Footer from "@/components/footer";
import JsonLd from "@/components/json-ld";
import DeferredLayoutWidgets from "@/components/deferred-layout-widgets";
import { LanguageProvider } from "@/components/language-provider";
import { locales, Locale } from "@/lib/i18n";
import { buildTravelAgencyStructuredData } from "@/lib/structured-data";

// Generate static params for all locales
export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

type LayoutProps = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

export default async function LocaleLayout({ children, params }: LayoutProps) {
  // Validate locale param - this ensures the route is valid
  const { locale } = await params;
  if (!locales.includes(locale as Locale)) {
    // Invalid locale - this will be handled by Next.js 404
    return null;
  }

  const resolvedLocale = locale as Locale;

  return (
    <LanguageProvider initialLocale={locale as Locale}>
      <JsonLd id="structured-data-travel-agency" data={buildTravelAgencyStructuredData(resolvedLocale)} />
      <div className="page">
        <Header />
        {children}
        <Footer locale={locale} />
        <React.Suspense fallback={null}>
          <DeferredLayoutWidgets locale={locale as Locale} />
        </React.Suspense>
      </div>
    </LanguageProvider>
  );
}
