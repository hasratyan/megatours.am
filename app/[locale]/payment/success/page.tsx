import Link from "next/link";
import { cookies } from "next/headers";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { buildLocalizedMetadata } from "@/lib/metadata";
import { defaultLocale, getTranslations, Locale, locales } from "@/lib/i18n";
import { getDb } from "@/lib/db";
import PackageBuilderResetOnConfirm from "@/components/package-builder-reset-on-confirm";
import { getHotelInfoFromDb } from "@/lib/hotel-info-db";
import { calculateBookingTotal } from "@/lib/booking-total";
import { getAoryxHotelPlatformFee } from "@/lib/pricing";
import { formatCurrencyAmount } from "@/lib/currency";

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

  let bookingRecord: any = null;
  let userBookingRecord: any = null;
  let hotelName = null;
  let destinationName: string | null = null;
  let errorKey: keyof typeof t.payment.errors | null = null;

  if (typeof EDP_BILL_NO !== "string" && !orderIdParam && !orderNumberParam) {
    errorKey = "invalidBill";
  } else {
    const db = await getDb();
    if (typeof EDP_BILL_NO === "string") {
      bookingRecord = await db.collection("idram_payments").findOne({ billNo: EDP_BILL_NO });
    } else if (orderIdParam) {
      bookingRecord = await db.collection("vpos_payments").findOne({ orderId: orderIdParam });
    } else if (orderNumberParam) {
      bookingRecord = await db.collection("vpos_payments").findOne({ orderNumber: orderNumberParam });
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
        userBookingRecord = await db.collection("user_bookings").findOne(
          {
            userIdString: sessionUserId,
            "payload.customerRefNumber": customerRefNumber,
          },
          {
            projection: { booking: 1 },
          }
        );
      }

      hotelName = bookingRecord.payload?.hotelName;
      if (!hotelName && bookingRecord.payload?.hotelCode) {
        const info = await getHotelInfoFromDb(bookingRecord.payload.hotelCode);
        hotelName = info?.name;
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
          typeof (destinationSearch as any)?.resultSummary?.destinationName === "string"
            ? (destinationSearch as any).resultSummary.destinationName.trim()
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

  return (
    <main className="container payment-status success">
      <PackageBuilderResetOnConfirm enabled={isBookingConfirmed} />
      <span className="material-symbols-rounded">{isBookingConfirmed ? "check" : "hourglass_top"}</span>
      <h1>{isBookingConfirmed ? t.payment.success.title : t.profile.bookings.status.pending}</h1>
      <p>{t.payment.success.body}</p>
      {isBookingPending ? <p>{t.payment.success.note}</p> : null}

      <div className="profile-item" style={{ textAlign: "left", width: "100%", maxWidth: "600px" }}>
        <div className="profile-item-header">
          <h3><span className="material-symbols-outlined">apartment</span>{hotelName || payload?.hotelCode}</h3>
        </div>
        <p className="profile-item-meta">
          {t.profile.bookings.labels.bookingId}: {payload?.customerRefNumber ?? "—"}
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
              {payload?.rooms.reduce(
                (acc: number, r: any) => acc + r.adults + (r.childrenAges?.length || 0),
                0
              )}
            </strong>
          </div>

          <div>
            <span>{t.profile.bookings.labels.total}</span>
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

      {!isBookingPending ? <p>{t.payment.success.note}</p> : null}
      <div className="profile-actions">
        {isBookingConfirmed && payload?.customerRefNumber ? (
          <Link
            href={`/${locale}/profile/voucher/${encodeURIComponent(payload.customerRefNumber)}`}
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
