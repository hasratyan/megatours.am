import Link from "next/link";
import { cookies } from "next/headers";
import { getServerSession } from "@/lib/auth-compat/server";
import { authOptions } from "@/lib/auth";
import type { BookingAddonServiceKey } from "@/lib/booking-addons";
import { buildLocalizedMetadata } from "@/lib/metadata";
import { defaultLocale, getTranslations, Locale, locales } from "@/lib/i18n";
import { getDb } from "@/lib/db";
import PackageBuilderResetOnConfirm from "@/components/package-builder-reset-on-confirm";
import { getHotelInfoFromDb } from "@/lib/hotel-info-db";
import { calculateBookingTotal } from "@/lib/booking-total";
import { getAoryxHotelPlatformFee } from "@/lib/pricing";
import { formatCurrencyAmount } from "@/lib/currency";
import type { AoryxBookingPayload, AoryxBookingResult } from "@/types/aoryx";

const resolveLocaleFromParam = (value: string | undefined) =>
  locales.includes(value as Locale) ? (value as Locale) : defaultLocale;

const resolveLocaleFromCookie = async () => {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get("megatours-locale")?.value;
  return locales.includes(cookieLocale as Locale) ? (cookieLocale as Locale) : defaultLocale;
};

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const resolvedLocale = resolveLocaleFromParam(locale);
  const t = getTranslations(resolvedLocale);
  return buildLocalizedMetadata({
    locale: resolvedLocale,
    title: t.payment.success.title,
    description: t.payment.success.body,
    path: "/payment/success",
  });
}

const formatDate = (dateStr: string | null | undefined, locale: string) => {
  if (!dateStr) return "—";
  try {
    const date = new Date(dateStr);
    return new Intl.DateTimeFormat(locale === "hy" ? "hy-AM" : locale === "ru" ? "ru-RU" : "en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(date);
  } catch {
    return dateStr;
  }
};

const resolveLocaleTag = (locale: string) => {
  if (locale === "hy") return "hy-AM";
  if (locale === "ru") return "ru-RU";
  return "en-GB";
};

const normalizeDisplayCurrency = (value: string | null | undefined): string | null => {
  const normalized = (value ?? "").trim().toUpperCase();
  if (!normalized) return null;
  if (normalized === "051") return "AMD";
  if (normalized === "840") return "USD";
  if (normalized === "978") return "EUR";
  if (normalized === "643") return "RUB";
  return normalized;
};

const addonServiceIconMap: Record<BookingAddonServiceKey, string> = {
  transfer: "directions_car",
  excursion: "tour",
  insurance: "shield_with_heart",
  flight: "flight",
};

const isAddonServiceKey = (value: unknown): value is BookingAddonServiceKey =>
  value === "transfer" || value === "excursion" || value === "insurance" || value === "flight";

const resolveAddonServiceKeys = (value: unknown): BookingAddonServiceKey[] => {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter(isAddonServiceKey)));
};

const resolveAddonServiceLabel = (
  service: BookingAddonServiceKey,
  t: ReturnType<typeof getTranslations>
) => {
  if (service === "transfer") return t.packageBuilder.services.transfer;
  if (service === "excursion") return t.packageBuilder.services.excursion;
  if (service === "insurance") return t.packageBuilder.services.insurance;
  return t.packageBuilder.services.flight;
};

type PaymentSuccessRecord = {
  userId?: string | null;
  flow?: string | null;
  status?: string | null;
  payload?: AoryxBookingPayload | null;
  bookingResult?: AoryxBookingResult | null;
  amount?: {
    value?: number | null;
    currency?: string | null;
    currencyCode?: string | null;
  } | null;
  addon?: {
    customerRefNumber?: string | null;
    serviceKeys?: unknown;
  } | null;
  addonApply?: {
    requestedServices?: unknown;
    appliedServices?: unknown;
    skippedServices?: unknown;
  } | null;
};

type UserBookingLookupRecord = {
  booking?: {
    status?: string | null;
    hotelConfirmationNumber?: string | null;
    supplierConfirmationNumber?: string | null;
    adsConfirmationNumber?: string | null;
  } | null;
};

type DestinationSearchRecord = {
  resultSummary?: {
    destinationName?: string | null;
  } | null;
};

export default async function PaymentSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { EDP_BILL_NO, orderId, orderNumber, mdOrder } = await searchParams;
  const orderIdParam =
    typeof orderId === "string" ? orderId : typeof mdOrder === "string" ? mdOrder : null;
  const orderNumberParam = typeof orderNumber === "string" ? orderNumber : null;
  const locale = await resolveLocaleFromCookie();
  const t = getTranslations(locale);
  const session = await getServerSession(authOptions);
  const sessionUserId = session?.user?.id ?? null;

  let bookingRecord: PaymentSuccessRecord | null = null;
  let userBookingRecord: UserBookingLookupRecord | null = null;
  let hotelName: string | null = null;
  let destinationName: string | null = null;
  let errorKey: keyof typeof t.payment.errors | null = null;

  if (typeof EDP_BILL_NO !== "string" && !orderIdParam && !orderNumberParam) {
    errorKey = "invalidBill";
  } else {
    const db = await getDb();
    if (typeof EDP_BILL_NO === "string") {
      bookingRecord = (await db
        .collection("idram_payments")
        .findOne({ billNo: EDP_BILL_NO })) as PaymentSuccessRecord | null;
    } else if (orderIdParam) {
      bookingRecord = (await db
        .collection("vpos_payments")
        .findOne({ orderId: orderIdParam })) as PaymentSuccessRecord | null;
    } else if (orderNumberParam) {
      bookingRecord = (await db
        .collection("vpos_payments")
        .findOne({ orderNumber: orderNumberParam })) as PaymentSuccessRecord | null;
    }

    if (!bookingRecord) {
      errorKey = "invalidBill";
    } else if (!session?.user?.id) {
      errorKey = "signInRequired";
    } else if (bookingRecord.userId !== session.user.id) {
      errorKey = "unauthorized";
    }

    if (bookingRecord && !errorKey) {
      const customerRefNumber =
        typeof bookingRecord.payload?.customerRefNumber === "string"
          ? bookingRecord.payload.customerRefNumber.trim()
          : "";
      if (sessionUserId && customerRefNumber) {
        userBookingRecord = (await db.collection("user_bookings").findOne(
          {
            userIdString: sessionUserId,
            "payload.customerRefNumber": customerRefNumber,
          },
          {
            projection: { booking: 1 },
          }
        )) as UserBookingLookupRecord | null;
      }

      hotelName = bookingRecord.payload?.hotelName ?? null;
      if (!hotelName && bookingRecord.payload?.hotelCode) {
        const info = await getHotelInfoFromDb(bookingRecord.payload.hotelCode);
        hotelName = info?.name ?? null;
      }

      const destinationCode =
        typeof bookingRecord.payload?.destinationCode === "string"
          ? bookingRecord.payload.destinationCode.trim()
          : "";
      if (destinationCode && sessionUserId) {
        const destinationSearch = await db.collection("user_searches").findOne(
          {
            userIdString: sessionUserId,
            "resultSummary.destinationCode": destinationCode,
          },
          {
            sort: { createdAt: -1 },
            projection: { resultSummary: 1 },
          }
        );
        const resolvedDestination =
          typeof (destinationSearch as DestinationSearchRecord | null)?.resultSummary?.destinationName ===
          "string"
            ? (destinationSearch as DestinationSearchRecord).resultSummary?.destinationName?.trim() ?? ""
            : "";
        destinationName = resolvedDestination || null;
      }
    }
  }

  if (errorKey) {
    return (
      <main className="container payment-status failure">
        <span className="material-symbols-rounded">error</span>
        <h1>{t.profile.errors.title}</h1>
        <p>{t.payment.errors[errorKey]}</p>
        <Link href="/" className="payment-link">
          <span className="material-symbols-rounded">home</span>
          {t.payment.failure.cta}
        </Link>
      </main>
    );
  }

  const payload = bookingRecord?.payload;
  const bookingResult = bookingRecord?.bookingResult;
  const bookingStatus = typeof bookingRecord?.status === "string" ? bookingRecord.status : null;
  const paymentFlow =
    typeof bookingRecord?.flow === "string" ? bookingRecord.flow.trim().toLowerCase() : "booking";
  const isAddonFlow = paymentFlow === "booking_addons";
  const addonRequestedServices = resolveAddonServiceKeys(
    bookingRecord?.addonApply?.requestedServices ?? bookingRecord?.addon?.serviceKeys
  );
  const addonAppliedServices = resolveAddonServiceKeys(bookingRecord?.addonApply?.appliedServices);
  const addonSkippedServices = resolveAddonServiceKeys(bookingRecord?.addonApply?.skippedServices);
  const userBookingStatus =
    typeof userBookingRecord?.booking?.status === "string"
      ? userBookingRecord.booking.status.trim()
      : null;
  const hasUserBookingConfirmation =
    userBookingStatus === "2" ||
    Boolean(
      userBookingRecord?.booking?.hotelConfirmationNumber ||
        userBookingRecord?.booking?.supplierConfirmationNumber ||
        userBookingRecord?.booking?.adsConfirmationNumber
    );
  const isBookingConfirmed =
    bookingStatus === "booking_complete" || Boolean(bookingResult) || hasUserBookingConfirmation;
  const isBookingPending =
    !isBookingConfirmed &&
    (bookingStatus === "booking_in_progress" || bookingStatus === "payment_success" || bookingStatus === "created");
  const isAddonApplied = isAddonFlow && bookingStatus === "booking_complete";
  const isAddonPending =
    isAddonFlow &&
    !isAddonApplied &&
    (bookingStatus === "booking_in_progress" ||
      bookingStatus === "payment_success" ||
      bookingStatus === "created");
  const isSuccessComplete = isAddonFlow ? isAddonApplied : isBookingConfirmed;
  const isSuccessPending = isAddonFlow ? isAddonPending : isBookingPending;
  const confirmationNumber =
    bookingResult?.hotelConfirmationNumber ||
    bookingResult?.supplierConfirmationNumber ||
    userBookingRecord?.booking?.hotelConfirmationNumber ||
    userBookingRecord?.booking?.supplierConfirmationNumber ||
    userBookingRecord?.booking?.adsConfirmationNumber ||
    null;
  const hotelMarkup = await getAoryxHotelPlatformFee();
  const fallbackTotal = payload ? calculateBookingTotal(payload, { hotelMarkup }) : null;
  const paidAmount =
    typeof bookingRecord?.amount?.value === "number" && Number.isFinite(bookingRecord.amount.value)
      ? bookingRecord.amount.value
      : fallbackTotal;
  const paidCurrency =
    normalizeDisplayCurrency(bookingRecord?.amount?.currency ?? bookingRecord?.amount?.currencyCode) ??
    normalizeDisplayCurrency(payload?.currency) ??
    "USD";
  const totalLabel =
    formatCurrencyAmount(paidAmount, paidCurrency, resolveLocaleTag(locale)) ??
    (paidAmount !== null ? `${paidAmount} ${paidCurrency}` : "—");
  const destinationLabel = destinationName ?? payload?.destinationCode ?? null;
  const customerRefNumber =
    typeof payload?.customerRefNumber === "string" && payload.customerRefNumber.trim().length > 0
      ? payload.customerRefNumber.trim()
      : typeof bookingRecord?.addon?.customerRefNumber === "string" &&
          bookingRecord.addon.customerRefNumber.trim().length > 0
        ? bookingRecord.addon.customerRefNumber.trim()
        : null;
  const statusIcon = isSuccessComplete ? "check" : "hourglass_top";
  const statusTitle = isAddonFlow
    ? isAddonApplied
      ? t.payment.success.addons.title
      : t.payment.success.addons.pendingTitle
    : isSuccessComplete
      ? t.payment.success.title
      : t.profile.bookings.status.pending;
  const statusBody = isAddonFlow
    ? isAddonApplied
      ? t.payment.success.addons.body
      : t.payment.success.addons.pendingBody
    : t.payment.success.body;

  return (
    <main className="container payment-status success">
      <PackageBuilderResetOnConfirm enabled={isAddonFlow ? isAddonApplied : isBookingConfirmed} />
      <span className="material-symbols-rounded">{statusIcon}</span>
      <h1>{statusTitle}</h1>
      <p>{statusBody}</p>
      {!isAddonFlow && isSuccessPending ? <p>{t.payment.success.note}</p> : null}

      <div className="profile-item" style={{ textAlign: "left", width: "100%", maxWidth: "600px" }}>
        <div className="profile-item-header">
          <h3><span className="material-symbols-outlined">apartment</span>{hotelName || payload?.hotelCode}</h3>
        </div>
        <p className="profile-item-meta">
          {t.profile.bookings.labels.bookingId}: {customerRefNumber ?? "—"}
          {destinationLabel ? ` • ${t.profile.bookings.labels.destination}: ${destinationLabel}` : ""}
        </p>

        <div className="profile-item-grid">
          <div>
            <span>{t.profile.searches.labels.dates}</span>
            <strong>
              {formatDate(payload?.checkInDate, locale)} — {formatDate(payload?.checkOutDate, locale)}
            </strong>
          </div>

          <div>
            <span>{t.profile.bookings.labels.guests}</span>
              <strong>
                {payload?.rooms?.reduce(
                  (acc: number, r) => acc + r.adults + (r.childrenAges?.length || 0),
                  0
                ) ?? 0}
              </strong>
            </div>

          <div>
            <span>{isAddonFlow ? t.profile.voucher.addServices.totalDue : t.profile.bookings.labels.total}</span>
            <strong>{totalLabel}</strong>
          </div>

          {confirmationNumber && (
            <div>
              <span>{t.profile.bookings.labels.confirmation}</span>
              <strong>{confirmationNumber}</strong>
            </div>
          )}
        </div>
      </div>

      {isAddonFlow && addonRequestedServices.length > 0 ? (
        <div
          className="profile-item booking-addons-last-payment"
          style={{ textAlign: "left", width: "100%", maxWidth: "600px" }}
        >
          <div className="profile-item-header">
            <h3>
              <span className="material-symbols-outlined">playlist_add_check_circle</span>
              {t.profile.voucher.addServices.lastPaymentTitle}
            </h3>
          </div>

          <div className="booking-addons-last-payment__grid">
            <div className="booking-addons-last-payment__group">
              <span>{t.profile.voucher.addServices.lastPaymentRequested}</span>
              <div className="booking-addons-pills">
                {addonRequestedServices.map((service) => (
                  <span key={`requested-${service}`} className="booking-addons-pill">
                    <span className="material-symbols-rounded">{addonServiceIconMap[service]}</span>
                    {resolveAddonServiceLabel(service, t)}
                  </span>
                ))}
              </div>
            </div>

            {addonAppliedServices.length > 0 ? (
              <div className="booking-addons-last-payment__group">
                <span>{t.profile.voucher.addServices.lastPaymentApplied}</span>
                <div className="booking-addons-pills">
                  {addonAppliedServices.map((service) => (
                    <span key={`applied-${service}`} className="booking-addons-pill is-success">
                      <span className="material-symbols-rounded">{addonServiceIconMap[service]}</span>
                      {resolveAddonServiceLabel(service, t)}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {addonSkippedServices.length > 0 ? (
              <div className="booking-addons-last-payment__group">
                <span>{t.profile.voucher.addServices.lastPaymentSkipped}</span>
                <div className="booking-addons-pills">
                  {addonSkippedServices.map((service) => (
                    <span key={`skipped-${service}`} className="booking-addons-pill is-warning">
                      <span className="material-symbols-rounded">{addonServiceIconMap[service]}</span>
                      {resolveAddonServiceLabel(service, t)}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {!isAddonFlow && !isSuccessPending ? <p>{t.payment.success.note}</p> : null}
      <div className="profile-actions">
        {(isAddonFlow || isBookingConfirmed) && customerRefNumber ? (
          <Link
            href={`/${locale}/profile/voucher/${encodeURIComponent(customerRefNumber)}`}
            className="payment-link"
          >
            <span className="material-symbols-rounded">description</span>
            {t.profile.bookings.viewVoucher}
          </Link>
        ) : null}
        <Link href="/profile" className="payment-link">
          <span className="material-symbols-rounded">account_circle</span>
          {t.payment.success.cta}
        </Link>
      </div>
    </main>
  );
}
