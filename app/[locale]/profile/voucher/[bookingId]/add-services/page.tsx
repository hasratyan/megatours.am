import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import BookingAddonsClient from "@/components/booking-addons-client";
import ProfileSignIn from "@/components/profile-signin";
import { authOptions } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { buildLocalizedMetadata } from "@/lib/metadata";
import { defaultLocale, getTranslations, Locale, locales } from "@/lib/i18n";
import { isBookingModificationClosed } from "@/lib/booking-modification";
import { DEFAULT_SERVICE_FLAGS } from "@/lib/package-builder-state";
import { getServiceFlags } from "@/lib/service-flags";
import {
  DEFAULT_PAYMENT_METHOD_FLAGS,
  getPaymentMethodFlags,
} from "@/lib/payment-method-flags";
import {
  isBookingCanceled,
  isBookingConfirmed,
  resolveBookingAddonHotelContext,
  resolveExistingBookingAddonServiceKeys,
} from "@/lib/booking-addons";
import type { AoryxBookingPayload, AoryxBookingResult } from "@/types/aoryx";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ locale: string; bookingId: string }>;
};

const resolveLocale = (value: string | undefined) =>
  locales.includes(value as Locale) ? (value as Locale) : defaultLocale;

export async function generateMetadata({ params }: PageProps) {
  const { locale, bookingId } = await params;
  const resolvedLocale = resolveLocale(locale);
  const t = getTranslations(resolvedLocale);
  const trimmedBookingId = bookingId?.trim();
  return buildLocalizedMetadata({
    locale: resolvedLocale,
    title: t.packageBuilder.title,
    description: t.packageBuilder.subtitle,
    path: trimmedBookingId
      ? `/profile/voucher/${trimmedBookingId}/add-services`
      : "/profile/voucher",
  });
}

export default async function BookingAddonsPage({ params }: PageProps) {
  const { locale, bookingId } = await params;
  const resolvedLocale = resolveLocale(locale);
  const t = getTranslations(resolvedLocale);

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return (
      <main className="container voucher-page">
        <ProfileSignIn />
      </main>
    );
  }

  const userIdString = session.user.id;
  const db = await getDb();
  const bookingRecord = await db.collection("user_bookings").findOne({
    userIdString,
    "payload.customerRefNumber": bookingId,
  });

  if (!bookingRecord?.payload) {
    notFound();
  }

  const payload = bookingRecord.payload as AoryxBookingPayload;
  const booking = (bookingRecord.booking ?? null) as AoryxBookingResult | null;
  const confirmed = isBookingConfirmed(booking);
  const canceled = isBookingCanceled(booking);
  const modificationClosed = isBookingModificationClosed(payload.checkOutDate);
  const voucherHref = `/${resolvedLocale}/profile/voucher/${encodeURIComponent(bookingId)}`;

  if (!confirmed || canceled || modificationClosed) {
    return (
      <main className="container payment-status failure">
        <span className="material-symbols-rounded">error</span>
        <h1>{t.profile.errors.title}</h1>
        <p>
          {!confirmed
            ? t.profile.bookings.status.pending
            : canceled
            ? t.profile.bookings.status.failed
            : t.profile.voucher.modificationClosed}
        </p>
        <Link href={voucherHref} className="payment-link">
          <span className="material-symbols-rounded">description</span>
          {t.profile.bookings.viewVoucher}
        </Link>
      </main>
    );
  }

  const [serviceFlags, paymentMethodFlags] = await Promise.all([
    getServiceFlags().catch(() => DEFAULT_SERVICE_FLAGS),
    getPaymentMethodFlags().catch(() => DEFAULT_PAYMENT_METHOD_FLAGS),
  ]);

  const existingServices = resolveExistingBookingAddonServiceKeys(payload);
  const hotelContext = resolveBookingAddonHotelContext(payload);

  if (!hotelContext) {
    notFound();
  }

  return (
    <BookingAddonsClient
      bookingId={bookingId}
      voucherHref={voucherHref}
      hotelContext={hotelContext}
      existingServices={existingServices}
      serviceFlags={{
        transfer: serviceFlags.transfer !== false,
        excursion: serviceFlags.excursion !== false,
        insurance: serviceFlags.insurance !== false,
        flight: serviceFlags.flight !== false,
      }}
      paymentMethodFlags={paymentMethodFlags}
    />
  );
}
