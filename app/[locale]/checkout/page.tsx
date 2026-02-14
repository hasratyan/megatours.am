import { getServerSession } from "next-auth";
import PackageCheckoutClient from "@/components/package-checkout-client";
import ProfileSignIn from "@/components/profile-signin";
import { authOptions } from "@/lib/auth";
import { buildLocalizedMetadata } from "@/lib/metadata";
import { defaultLocale, getTranslations, Locale, locales } from "@/lib/i18n";
import { DEFAULT_PAYMENT_METHOD_FLAGS, getPaymentMethodFlags } from "@/lib/payment-method-flags";

type PageProps = {
  params: Promise<{ locale: string }>;
};

export const dynamic = "force-dynamic";

const resolveLocale = (value: string | undefined) =>
  locales.includes(value as Locale) ? (value as Locale) : defaultLocale;

export async function generateMetadata({ params }: PageProps) {
  const resolvedParams = await params;
  const resolvedLocale = resolveLocale(resolvedParams.locale);
  const t = getTranslations(resolvedLocale);
  return buildLocalizedMetadata({
    locale: resolvedLocale,
    title: t.packageBuilder.checkout.title,
    description: t.packageBuilder.checkout.subtitle,
    path: "/checkout",
  });
}

export default async function CheckoutPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return (
      <main className="container">
        <ProfileSignIn />
      </main>
    );
  }
  let paymentMethodFlags = DEFAULT_PAYMENT_METHOD_FLAGS;
  try {
    paymentMethodFlags = await getPaymentMethodFlags();
  } catch (error) {
    console.error("[CheckoutPage] Failed to load payment method flags", error);
  }
  return <PackageCheckoutClient initialPaymentMethodFlags={paymentMethodFlags} />;
}
