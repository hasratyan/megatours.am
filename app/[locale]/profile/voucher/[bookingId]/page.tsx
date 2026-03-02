import { notFound } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import ProfileSignIn from "@/components/profile-signin";
import VoucherActions from "@/components/voucher-actions";
import { authOptions } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { resolveBookingDisplayTotal } from "@/lib/booking-total";
import { formatCurrencyAmount, normalizeAmount } from "@/lib/currency";
import { applyMarkup } from "@/lib/pricing-utils";
import { getAmdRates, getAoryxHotelPlatformFee } from "@/lib/pricing";
import { buildLocalizedMetadata } from "@/lib/metadata";
import { defaultLocale, getTranslations, Locale, locales } from "@/lib/i18n";
import { resolveBookingStatusKey } from "@/lib/booking-status";
import { getServiceFlags } from "@/lib/service-flags";
import { DEFAULT_SERVICE_FLAGS } from "@/lib/package-builder-state";
import { resolveExistingBookingAddonServiceKeys } from "@/lib/booking-addons";
import type { AoryxBookingPayload, AoryxBookingResult } from "@/types/aoryx";
import type { AppliedBookingCoupon } from "@/lib/user-data";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ locale: string; bookingId: string }>;
};

type RefundServiceKey = "transfer" | "excursion" | "flight";
type VoucherServiceKey = RefundServiceKey | "hotel" | "insurance";
type VoucherRefundStateKey = "refunded" | "already_refunded" | "in_progress" | "failed" | "unknown";

type BookingCancellationRecord = {
  at?: Date | string | null;
  cancelStatus?: string | null;
  refund?: {
    status?: string | null;
    amountValue?: number | null;
    currencyCode?: string | null;
    services?: unknown;
  } | null;
} | null;

type ServiceCard = {
  id: VoucherServiceKey;
  title: string;
  price: string;
  details: string[];
};

type StoredEfesPolicy = {
  travelerId: string | null;
  contractNumber: string | null;
  externalId: string | null;
};

const resolveLocale = (value: string | undefined) =>
  locales.includes(value as Locale) ? (value as Locale) : defaultLocale;

export async function generateMetadata({ params }: { params: Promise<{ locale: string; bookingId: string }> }) {
  const { locale, bookingId } = await params;
  const resolvedLocale = resolveLocale(locale);
  const t = getTranslations(resolvedLocale);
  const trimmedBookingId = bookingId?.trim();
  return buildLocalizedMetadata({
    locale: resolvedLocale,
    title: t.profile.voucher.title,
    description: t.profile.voucher.subtitle,
    path: trimmedBookingId ? `/profile/voucher/${trimmedBookingId}` : "/profile/voucher",
  });
}

const parseSearchDate = (value?: string | null) => {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDate = (value: Date | string | null | undefined, locale: string) => {
  if (!value) return "—";
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  if (locale.startsWith("hy")) {
    const months = ["հնվ", "փտվ", "մրտ", "ապր", "մյս", "հնս", "հլս", "օգս", "սեպ", "հոկ", "նոյ", "դեկ"];
    const day = parsed.getDate().toString().padStart(2, "0");
    const month = months[parsed.getMonth()];
    return `${day} ${month}, ${parsed.getFullYear()} թ.`;
  }
  return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric" }).format(parsed);
};

const formatDateTime = (value: string | null | undefined, locale: string) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
};

const formatDateRange = (start?: string | null, end?: string | null, locale?: string) => {
  const parsedStart = parseSearchDate(start ?? null);
  const parsedEnd = parseSearchDate(end ?? null);
  if (!parsedStart || !parsedEnd || !locale) return null;
  if (locale.startsWith("hy")) {
    const months = ["հնվ", "փտվ", "մրտ", "ապր", "մյս", "հնս", "հլս", "օգս", "սեպ", "հոկ", "նոյ", "դեկ"];
    const startDay = parsedStart.getDate().toString().padStart(2, "0");
    const endDay = parsedEnd.getDate().toString().padStart(2, "0");
    const startMonth = months[parsedStart.getMonth()];
    const endMonth = months[parsedEnd.getMonth()];
    return `${startDay} ${startMonth} — ${endDay} ${endMonth}`;
  }
  const formatter = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" });
  return `${formatter.format(parsedStart)} — ${formatter.format(parsedEnd)}`;
};

const getNights = (start?: string | null, end?: string | null) => {
  const startDate = parseSearchDate(start ?? null);
  const endDate = parseSearchDate(end ?? null);
  if (!startDate || !endDate) return null;
  const diff = endDate.getTime() - startDate.getTime();
  const nights = Math.round(diff / (1000 * 60 * 60 * 24));
  return nights > 0 ? nights : null;
};

const countGuestsFromRooms = (rooms: AoryxBookingPayload["rooms"]) =>
  rooms.reduce((sum, room) => sum + room.adults + room.childrenAges.length, 0);

const resolveRefundStateKey = (value?: string | null): VoucherRefundStateKey | null => {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "already_refunded") return "already_refunded";
  if (normalized.includes("refunded")) return "refunded";
  if (
    normalized.includes("in_progress") ||
    normalized.includes("requested") ||
    normalized.includes("processing") ||
    normalized.includes("manual")
  ) {
    return "in_progress";
  }
  if (normalized.includes("fail") || normalized.includes("error")) return "failed";
  return "unknown";
};

const normalizeCurrencyCode = (value: unknown) => {
  const raw = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!raw) return "AMD";
  if (raw === "051" || raw === "AMD") return "AMD";
  if (raw === "840" || raw === "USD") return "USD";
  if (raw === "978" || raw === "EUR") return "EUR";
  if (raw === "643" || raw === "RUB") return "RUB";
  return raw;
};

const parseRefundServiceKeys = (value: unknown): RefundServiceKey[] => {
  if (!Array.isArray(value)) return [];
  const parsed = value
    .map((item) => (typeof item === "string" ? item.trim().toLowerCase() : ""))
    .filter((item): item is RefundServiceKey =>
      item === "transfer" || item === "excursion" || item === "flight"
    );
  return Array.from(new Set(parsed));
};

const normalizeAppliedCoupon = (value: unknown): AppliedBookingCoupon | null => {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const code = typeof record.code === "string" ? record.code.trim().toUpperCase() : "";
  const discountPercent =
    typeof record.discountPercent === "number" && Number.isFinite(record.discountPercent)
      ? Math.min(100, Math.max(0, record.discountPercent))
      : null;
  if (!code || discountPercent === null || discountPercent <= 0) return null;
  return {
    code,
    discountPercent,
    discountAmount:
      typeof record.discountAmount === "number" && Number.isFinite(record.discountAmount)
        ? record.discountAmount
        : null,
    discountedAmount:
      typeof record.discountedAmount === "number" && Number.isFinite(record.discountedAmount)
        ? record.discountedAmount
        : null,
  };
};

const toOptionalText = (value: unknown): string | null => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
};

const parseStoredEfesPolicies = (value: unknown): StoredEfesPolicy[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const record = entry as Record<string, unknown>;
      const response =
        record.response && typeof record.response === "object"
          ? (record.response as Record<string, unknown>)
          : null;
      const travelerId = toOptionalText(record.travelerId);
      const contractNumber = toOptionalText(response?.result);
      const externalId = toOptionalText(response?.external_id ?? response?.externalId);
      if (!travelerId && !contractNumber && !externalId) return null;
      return {
        travelerId,
        contractNumber,
        externalId,
      };
    })
    .filter((entry): entry is StoredEfesPolicy => Boolean(entry));
};

const humanizeSubriskLabel = (value: string) =>
  value
    .trim()
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());

const resolveIndexedLabel = (template: string, index: number) =>
  template.includes("{index}") ? template.replace("{index}", String(index + 1)) : `${template} ${index + 1}`;

export default async function VoucherPage({ params }: PageProps) {
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
  const storedInsurancePolicies = parseStoredEfesPolicies(
    (bookingRecord as { insurancePolicies?: unknown }).insurancePolicies ?? null
  );
  const appliedCoupon = normalizeAppliedCoupon((bookingRecord as { coupon?: unknown }).coupon ?? null);
  const cancellation =
    ((bookingRecord as { cancellation?: BookingCancellationRecord }).cancellation ?? null) as BookingCancellationRecord;
  const refundRecord = cancellation?.refund ?? null;
  const refundStateKey = resolveRefundStateKey(refundRecord?.status ?? null);
  const refundedServices = parseRefundServiceKeys(refundRecord?.services ?? null);
  const refundedServicesSet = new Set<RefundServiceKey>(refundedServices);
  const refundedAmountValue =
    typeof refundRecord?.amountValue === "number" && Number.isFinite(refundRecord.amountValue)
      ? refundRecord.amountValue
      : null;
  const refundCurrency = normalizeCurrencyCode(refundRecord?.currencyCode ?? payload.currency);
  const createdAt = bookingRecord.createdAt ? new Date(bookingRecord.createdAt) : null;
  const [hotelMarkup, rates] = await Promise.all([
    getAoryxHotelPlatformFee(),
    getAmdRates().catch((error) => {
      console.error("[Voucher] Failed to load AMD rates", error);
      return null;
    }),
  ]);
  const destinationCode = payload.destinationCode?.trim();
  let destinationName: string | null = null;
  if (destinationCode) {
    const destinationSearch = await db.collection("user_searches").findOne(
      {
        userIdString,
        "resultSummary.destinationCode": destinationCode,
      },
      {
        sort: { createdAt: -1 },
        projection: { resultSummary: 1 },
      }
    );
    const destinationSummary = (
      destinationSearch as { resultSummary?: { destinationName?: unknown } } | null
    )?.resultSummary;
    const resolvedDestination =
      typeof destinationSummary?.destinationName === "string"
        ? destinationSummary.destinationName.trim()
        : "";
    destinationName = resolvedDestination || null;
  }
  const destinationLabel = destinationName ?? destinationCode ?? null;

  const statusKey = resolveBookingStatusKey(booking?.status ?? null);
  const statusLabel = t.profile.bookings.status[statusKey];
  const cancellationStatusKey = resolveBookingStatusKey(cancellation?.cancelStatus ?? null);
  const bookingCanceledByAdmin = cancellationStatusKey === "failed";
  const bookingSourceRaw = (bookingRecord as { source?: unknown }).source;
  const bookingSource = typeof bookingSourceRaw === "string" ? bookingSourceRaw.trim().toLowerCase() : "";
  const paymentMethodLabel = (() => {
    if (!bookingSource) return "—";
    if (bookingSource.includes("idram")) return t.packageBuilder.checkout.methodIdram;
    if (bookingSource.includes("ameria")) return t.packageBuilder.checkout.methodCardAmeria;
    if (bookingSource.includes("idbank") || bookingSource.includes("vpos")) {
      return t.packageBuilder.checkout.methodCard;
    }
    return "—";
  })();
  const dateRange = formatDateRange(payload.checkInDate, payload.checkOutDate, resolvedLocale);
  const issuedOn = createdAt ? formatDate(createdAt, resolvedLocale) : "—";
  const nights = getNights(payload.checkInDate, payload.checkOutDate);
  const roomsCount = payload.rooms.length;
  const guestsCount = countGuestsFromRooms(payload.rooms);
  const confirmation =
    booking?.hotelConfirmationNumber ??
    booking?.supplierConfirmationNumber ??
    booking?.adsConfirmationNumber ??
    "—";

  const roomsTotal = payload.rooms.reduce((sum, room) => {
    const net = room.price.net;
    const gross = room.price.gross;
    const price =
      typeof net === "number" && Number.isFinite(net)
        ? net
        : typeof gross === "number" && Number.isFinite(gross)
          ? gross
          : 0;
    return sum + price;
  }, 0);
  const roomsTotalWithMarkup = applyMarkup(roomsTotal, hotelMarkup) ?? roomsTotal;
  const formatDisplayPrice = (amount: number | null | undefined, currency: string | null | undefined) => {
    const normalized = normalizeAmount(amount ?? null, currency ?? null, rates);
    if (!normalized) return "—";
    return formatCurrencyAmount(normalized.amount, normalized.currency, "en-GB") ?? "—";
  };
  const resolveServiceLabel = (service: RefundServiceKey) => {
    if (service === "transfer") return t.packageBuilder.services.transfer;
    if (service === "excursion") return t.packageBuilder.services.excursion;
    return t.packageBuilder.services.flight;
  };
  const resolveServiceUpdateNote = (service: RefundServiceKey) => {
    if (!refundedServicesSet.has(service)) return null;
    if (refundStateKey === "in_progress") return t.profile.voucher.updates.serviceCancelPending;
    if (refundStateKey === "failed") return t.profile.voucher.updates.serviceCancelFailed;
    return t.profile.voucher.updates.serviceCanceled;
  };
  const displayTotal = resolveBookingDisplayTotal(payload, rates, { hotelMarkup });
  const totalLabel = formatCurrencyAmount(displayTotal.amount, displayTotal.currency, "en-GB") ?? "—";
  const refundedAmountLabel =
    refundedAmountValue !== null ? formatDisplayPrice(refundedAmountValue, refundCurrency) : null;
  const refundStatusLabel = refundStateKey ? t.profile.voucher.updates.refundStates[refundStateKey] : null;
  const refundedServicesLabel =
    refundedServices.length > 0 ? refundedServices.map((service) => resolveServiceLabel(service)).join(", ") : null;
  const canceledOnLabel =
    cancellation?.at != null ? formatDate(cancellation.at, resolvedLocale) : null;
  const showBookingUpdates =
    bookingCanceledByAdmin ||
    refundStateKey !== null ||
    refundedAmountLabel !== null ||
    refundedServices.length > 0;

  const serviceFlags = await getServiceFlags().catch(() => DEFAULT_SERVICE_FLAGS);
  const existingAddonServices = new Set(resolveExistingBookingAddonServiceKeys(payload));
  const missingAddonServices = [
    { key: "transfer", enabled: serviceFlags.transfer !== false, label: t.packageBuilder.services.transfer },
    { key: "excursion", enabled: serviceFlags.excursion !== false, label: t.packageBuilder.services.excursion },
    { key: "insurance", enabled: serviceFlags.insurance !== false, label: t.packageBuilder.services.insurance },
    { key: "flight", enabled: serviceFlags.flight !== false, label: t.packageBuilder.services.flight },
  ]
    .filter((service) =>
      service.enabled &&
      !existingAddonServices.has(service.key as "transfer" | "excursion" | "insurance" | "flight")
    )
    .map((service) => service.label);
  const canManageAddons = statusKey === "confirmed" && !bookingCanceledByAdmin && missingAddonServices.length > 0;
  const manageAddonsHref = `/${resolvedLocale}/profile/voucher/${encodeURIComponent(bookingId)}/add-services`;

  const serviceCards: ServiceCard[] = [
    {
      id: "hotel",
      title: t.packageBuilder.services.hotel,
      price: formatDisplayPrice(roomsTotalWithMarkup, payload.currency),
      details: [
        payload.hotelName ?? payload.hotelCode ?? t.profile.bookings.labels.hotelName,
        destinationLabel
          ? `${t.profile.bookings.labels.destination}: ${destinationLabel}`
          : null,
        dateRange ? `${t.profile.searches.labels.dates}: ${dateRange}` : null,
        `${t.profile.bookings.labels.rooms}: ${roomsCount}`,
        `${t.profile.bookings.labels.guests}: ${guestsCount}`,
      ].filter(Boolean) as string[],
    },
  ];

  if (payload.transferSelection) {
    const route = [payload.transferSelection.origin?.name, payload.transferSelection.destination?.name]
      .filter(Boolean)
      .join(" → ");
    const transferFlightDetails = payload.transferSelection.flightDetails ?? null;
    const arrivalFlightNumber = transferFlightDetails?.flightNumber?.trim() ?? "";
    const arrivalDateTime = formatDateTime(
      transferFlightDetails?.arrivalDateTime ?? null,
      resolvedLocale
    );
    const departureFlightNumber = transferFlightDetails?.departureFlightNumber?.trim() ?? "";
    const departureDateTime = formatDateTime(
      transferFlightDetails?.departureDateTime ?? null,
      resolvedLocale
    );
    serviceCards.push({
      id: "transfer",
      title: t.packageBuilder.services.transfer,
      price: formatDisplayPrice(
        payload.transferSelection.totalPrice ?? null,
        payload.transferSelection.pricing?.currency ?? payload.currency
      ),
      details: [
        resolveServiceUpdateNote("transfer"),
        route ? `${t.packageBuilder.checkout.labels.route}: ${route}` : null,
        arrivalFlightNumber
          ? `${t.hotel.addons.transfers.flightNumber}: ${arrivalFlightNumber}`
          : null,
        arrivalDateTime
          ? `${t.hotel.addons.transfers.arrivalDate}: ${arrivalDateTime}`
          : null,
        payload.transferSelection.includeReturn && departureFlightNumber
          ? `${t.hotel.addons.transfers.departureFlightNumber}: ${departureFlightNumber}`
          : null,
        payload.transferSelection.includeReturn && departureDateTime
          ? `${t.hotel.addons.transfers.departureDate}: ${departureDateTime}`
          : null,
        payload.transferSelection.vehicle?.name
          ? `${t.packageBuilder.checkout.labels.vehicle}: ${payload.transferSelection.vehicle.name}`
          : null,
        payload.transferSelection.transferType
          ? `${t.packageBuilder.checkout.labels.type}: ${payload.transferSelection.transferType}`
          : null,
      ].filter(Boolean) as string[],
    });
  }

  if (payload.excursions) {
    const selections = payload.excursions.selections ?? [];
    const excursionDetails = selections.length
        ? selections.map((selection) => {
          const label = selection.name ?? selection.id;
          const quantityAdult =
            typeof selection.quantityAdult === "number" && Number.isFinite(selection.quantityAdult)
              ? selection.quantityAdult
              : 0;
          const quantityChild =
            typeof selection.quantityChild === "number" && Number.isFinite(selection.quantityChild)
              ? selection.quantityChild
              : 0;
          const parts: string[] = [];
          if (quantityAdult > 0) {
            parts.push(`${quantityAdult} ${t.packageBuilder.checkout.guestAdultLabel}`);
          }
          if (quantityChild > 0) {
            parts.push(`${quantityChild} ${t.packageBuilder.checkout.guestChildLabel}`);
          }
          const fallbackTotal =
            (typeof selection.priceAdult === "number" && Number.isFinite(selection.priceAdult)
              ? quantityAdult * selection.priceAdult
              : 0) +
            (typeof selection.priceChild === "number" && Number.isFinite(selection.priceChild)
              ? quantityChild * selection.priceChild
              : 0);
          const excursionRate = formatDisplayPrice(
            typeof selection.totalPrice === "number" && Number.isFinite(selection.totalPrice)
              ? selection.totalPrice
              : fallbackTotal > 0
                ? fallbackTotal
                : null,
            selection.currency ?? payload.currency
          );
          const summary = parts.length > 0 ? `${label} · ${parts.join(" / ")}` : label;
          return excursionRate !== "—"
            ? `${summary} · ${t.packageBuilder.checkout.labels.price}: ${excursionRate}`
            : summary;
        })
      : [];
    serviceCards.push({
      id: "excursion",
      title: t.packageBuilder.services.excursion,
      price: formatDisplayPrice(payload.excursions.totalAmount ?? null, selections[0]?.currency ?? payload.currency),
      details: [
        resolveServiceUpdateNote("excursion"),
        ...(excursionDetails.length > 0 ? excursionDetails : [t.packageBuilder.checkout.pendingDetails]),
      ].filter(Boolean) as string[],
    });
  }

  if (payload.insurance) {
    const policiesByTravelerId = new Map<string, StoredEfesPolicy>();
    const policiesWithoutTraveler: StoredEfesPolicy[] = [];
    storedInsurancePolicies.forEach((policy) => {
      if (policy.travelerId) {
        policiesByTravelerId.set(policy.travelerId, policy);
      } else {
        policiesWithoutTraveler.push(policy);
      }
    });
    const insuranceTravelers = payload.insurance.travelers ?? [];
    const subriskLabels: Record<string, string> = {
      AMATEUR_SPORT_EXPENCES: t.packageBuilder.insurance.subrisks.amateurSport.label,
      BAGGAGE_EXPENCES: t.packageBuilder.insurance.subrisks.baggage.label,
      TRAVEL_INCONVENIENCES: t.packageBuilder.insurance.subrisks.travelInconveniences.label,
      HOUSE_INSURANCE: t.packageBuilder.insurance.subrisks.houseInsurance.label,
      TRIP_CANCELLATION: t.packageBuilder.insurance.subrisks.tripCancellation.label,
    };
    const travelerInsuranceDetails = insuranceTravelers.flatMap((traveler, index) => {
      const matchedPolicy =
        (traveler.id ? policiesByTravelerId.get(traveler.id) : null) ??
        policiesWithoutTraveler[index] ??
        null;
      const travelerNameEn = [traveler.firstNameEn, traveler.lastNameEn].filter(Boolean).join(" ").trim();
      const travelerNameLocal = [traveler.firstName, traveler.lastName].filter(Boolean).join(" ").trim();
      const travelerName = travelerNameEn || travelerNameLocal || "—";
      const rateValue =
        (typeof traveler.premium === "number" && Number.isFinite(traveler.premium) && traveler.premium > 0
          ? traveler.premium
          : null) ??
        (typeof traveler.policyPremium === "number" &&
        Number.isFinite(traveler.policyPremium) &&
        traveler.policyPremium > 0
          ? traveler.policyPremium
          : null) ??
        (insuranceTravelers.length === 1 &&
        typeof payload.insurance?.price === "number" &&
        Number.isFinite(payload.insurance.price) &&
        payload.insurance.price > 0
          ? payload.insurance.price
          : null);
      const rateCurrency =
        traveler.premiumCurrency ?? payload.insurance?.currency ?? payload.currency;
      const travelerSubrisks =
        Array.isArray(traveler.subrisks) && traveler.subrisks.length > 0
          ? traveler.subrisks
          : Array.isArray(payload.insurance?.subrisks)
            ? payload.insurance.subrisks
            : [];
      const subriskSummary =
        travelerSubrisks.length > 0
          ? travelerSubrisks
              .map((subrisk) => {
                const normalized = subrisk.trim().toUpperCase();
                return subriskLabels[normalized] ?? humanizeSubriskLabel(subrisk);
              })
              .join(", ")
          : null;
      const travelerLabel = resolveIndexedLabel(t.packageBuilder.checkout.insuranceTravelerLabel, index);
      return [
        `${travelerLabel}: ${travelerName}`,
        matchedPolicy?.contractNumber
          ? `${t.profile.bookings.labels.confirmation}: ${matchedPolicy.contractNumber}`
          : null,
        rateValue !== null
          ? `${t.packageBuilder.checkout.labels.price}: ${formatDisplayPrice(rateValue, rateCurrency)}`
          : null,
        subriskSummary
          ? `${t.packageBuilder.insurance.subrisksTitle}: ${subriskSummary}`
          : null,
      ].filter(Boolean) as string[];
    });
    const fallbackPolicyDetails =
      insuranceTravelers.length === 0
        ? storedInsurancePolicies
            .map((policy) =>
              policy.contractNumber
                ? `${t.profile.bookings.labels.confirmation}: ${policy.contractNumber}`
                : null
            )
            .filter((detail): detail is string => Boolean(detail))
        : [];
    serviceCards.push({
      id: "insurance",
      title: t.packageBuilder.services.insurance,
      price: formatDisplayPrice(payload.insurance.price ?? null, payload.insurance.currency ?? payload.currency),
      details: [
        payload.insurance.planName ?? payload.insurance.planId,
        payload.insurance.note ?? null,
        ...travelerInsuranceDetails,
        ...fallbackPolicyDetails,
      ].filter(Boolean) as string[],
    });
  }

  if (payload.airTickets) {
    const route = [payload.airTickets.origin, payload.airTickets.destination].filter(Boolean).join(" → ");
    const dates = [payload.airTickets.departureDate, payload.airTickets.returnDate].filter(Boolean).join(" / ");
    serviceCards.push({
      id: "flight",
      title: t.packageBuilder.services.flight,
      price: formatDisplayPrice(payload.airTickets.price ?? null, payload.airTickets.currency ?? payload.currency),
      details: [
        resolveServiceUpdateNote("flight"),
        route ? `${t.packageBuilder.checkout.labels.route}: ${route}` : null,
        dates ? `${t.profile.searches.labels.dates}: ${dates}` : null,
        payload.airTickets.cabinClass ? payload.airTickets.cabinClass : null,
      ].filter(Boolean) as string[],
    });
  }

  return (
    <main className="voucher-page">
      <div className="container voucher-shell">
        <div className="voucher-hero">
          <div className="company-information">
            <svg width="100%" height="100%" viewBox="0 0 1091 143" version="1.1" xmlns="http://www.w3.org/2000/svg">
              <g transform="matrix(1,0,0,1,-2523.92,-3265.57)">
                  <g transform="matrix(1,0,0,1,-8406,2337)">
                      <g transform="matrix(0.472727,0,0,0.472727,8308.26,764.587)">
                          <path d="M5545.84,365.978L5566.58,365.978L5663.52,547.022L5757.81,365.978L5778.18,365.978L5778.18,630L5757.81,630L5757.81,404.827L5673.7,565.503C5671.94,568.772 5670.37,571.035 5668.99,572.292C5667.6,573.55 5666.03,574.178 5664.27,574.178L5657.86,574.178L5566.21,404.827L5566.21,630L5545.84,630L5545.84,365.978Z"/>
                      </g>
                    <g transform="matrix(0.472727,0,0,0.472727,8308.26,764.587)">
                          <path d="M5865.31,630C5857.51,630 5851.48,627.8 5847.2,623.399C5842.93,618.999 5840.79,612.901 5840.79,605.106L5840.79,365.978L6018.06,365.978L6018.06,390.117L5868.7,390.117L5868.7,482.902L6006.75,482.902L6006.75,507.041L5868.7,507.041L5868.7,605.861L6018.06,605.861L6018.06,630L5865.31,630Z"/>
                      </g>
                    <g transform="matrix(0.472727,0,0,0.472727,8308.26,764.587)">
                          <path d="M6147.43,633.017C6129.58,633.017 6113.8,628.994 6100.1,620.948C6086.39,612.901 6075.83,601.523 6068.41,586.813C6061,572.104 6057.29,555.068 6057.29,535.706L6057.29,460.271C6057.29,440.91 6061.12,423.874 6068.79,409.164C6076.46,394.454 6087.21,383.076 6101.04,375.03C6114.87,366.983 6130.84,362.96 6148.94,362.96L6189.68,362.96C6207.03,362.96 6222.36,366.543 6235.69,373.71C6249.02,380.876 6259.33,391.06 6266.62,404.261C6273.91,417.462 6277.56,432.612 6277.56,449.71L6242.48,449.71C6242.48,433.366 6237.64,420.165 6227.96,410.107C6218.28,400.049 6205.52,395.02 6189.68,395.02L6148.94,395.02C6132.35,395.02 6118.89,401.055 6108.58,413.125C6098.28,425.194 6093.12,441.161 6093.12,461.026L6093.12,534.952C6093.12,554.817 6098.09,570.784 6108.02,582.853C6117.95,594.923 6131.09,600.958 6147.43,600.958L6189.68,600.958C6205.77,600.958 6218.91,595.3 6229.09,583.985C6239.28,572.669 6244.37,558.085 6244.37,540.232L6244.37,522.128L6171.19,522.128L6171.19,490.823L6279.44,490.823L6279.44,540.232C6279.44,558.337 6275.67,574.43 6268.13,588.511C6260.59,602.592 6250.03,613.53 6236.45,621.325C6222.87,629.12 6207.28,633.017 6189.68,633.017L6147.43,633.017Z"/>
                      </g>
                    <g transform="matrix(0.472727,0,0,0.472727,8308.26,764.587)">
                          <path d="M6477.08,564.749L6372.23,564.749L6347.71,630L6302.07,630L6404.67,365.978L6424.66,365.978C6438.24,365.978 6447.66,372.641 6452.94,385.968L6547.24,630L6501.22,630L6477.08,564.749ZM6384.68,527.786L6464.64,527.786L6425.03,420.668L6424.66,420.668L6384.68,527.786Z"/>
                      </g>
                    <g transform="matrix(0.472727,0,0,0.472727,8308.26,764.587)">
                          <path d="M6639.27,411.239L6555.54,411.239L6555.54,365.978L6775.05,365.978L6775.05,411.239L6691.32,411.239L6691.32,630L6639.27,630L6639.27,411.239Z"/>
                      </g>
                    <g transform="matrix(0.472727,0,0,0.472727,8346.26,764.587)">
                          <path d="M7161.28,633.017C7144.18,633.017 7129.16,629.309 7116.21,621.891C7103.26,614.473 7093.26,603.975 7086.22,590.397C7079.18,576.818 7075.66,561.228 7075.66,543.627L7075.66,365.978L7111.49,365.978L7111.49,543.627C7111.49,560.726 7116.08,574.555 7125.26,585.116C7134.44,595.677 7146.44,600.958 7161.28,600.958L7201.64,600.958C7216.47,600.958 7228.48,595.677 7237.66,585.116C7246.84,574.555 7251.42,560.726 7251.42,543.627L7251.42,365.978L7287.26,365.978L7287.26,543.627C7287.26,561.228 7283.74,576.818 7276.69,590.397C7269.65,603.975 7259.66,614.473 7246.71,621.891C7233.76,629.309 7218.74,633.017 7201.64,633.017L7161.28,633.017Z"/>
                      </g>
                    <g transform="matrix(0.472727,0,0,0.472727,8346.26,764.587)">
                          <path d="M7343.83,365.978L7472.07,365.978C7491.43,365.978 7506.96,371.447 7518.65,382.385C7530.34,393.323 7536.19,407.718 7536.19,425.571L7536.19,453.105C7536.19,466.432 7531.92,478.187 7523.37,488.371C7514.82,498.555 7503.38,505.784 7489.04,510.058L7489.04,510.436C7496.59,514.459 7503.44,520.871 7509.6,529.672C7515.76,538.472 7520.48,548.405 7523.74,559.468L7544.49,630L7515.82,630L7495.08,559.468C7491.56,547.147 7485.46,537.215 7476.78,529.672C7468.11,522.128 7458.62,518.356 7448.31,518.356L7371.74,518.356L7371.74,630L7343.83,630L7343.83,365.978ZM7462.26,493.463C7476.09,493.463 7487.22,489.754 7495.64,482.336C7504.07,474.918 7508.28,465.175 7508.28,453.105L7508.28,424.063C7508.28,414.005 7504.89,405.958 7498.1,399.923C7491.31,393.889 7482.38,390.871 7471.32,390.871L7371.74,390.871L7371.74,493.463L7462.26,493.463Z"/>
                      </g>
                    <g transform="matrix(0.472727,0,0,0.472727,8346.26,764.587)">
                          <path d="M7655.38,633.017C7633,633.017 7615.21,626.354 7602.01,613.027C7588.81,599.7 7582.21,581.596 7582.21,558.714L7602.57,558.714C7602.57,575.813 7607.35,589.328 7616.91,599.26C7626.46,609.193 7639.41,614.159 7655.76,614.159L7698,614.159C7713.84,614.159 7726.6,610.513 7736.28,603.221C7745.96,595.929 7750.8,586.373 7750.8,574.555L7750.8,548.907C7750.8,539.352 7747.28,531.18 7740.24,524.391C7733.2,517.602 7723.4,513.202 7710.82,511.19L7643.31,499.875C7625.2,496.857 7611.06,490.32 7600.88,480.262C7590.69,470.204 7585.6,457.631 7585.6,442.544L7585.6,420.668C7585.6,403.318 7592.14,389.363 7605.21,378.802C7618.29,368.241 7635.51,362.96 7656.89,362.96L7699.51,362.96C7719.88,362.96 7736.28,369.121 7748.73,381.442C7761.18,393.763 7767.4,409.981 7767.4,430.097L7747.03,430.097C7747.03,415.513 7742.69,403.758 7734.02,394.832C7725.34,385.905 7713.84,381.442 7699.51,381.442L7656.89,381.442C7641.55,381.442 7629.29,385.025 7620.11,392.191C7610.93,399.358 7606.35,408.85 7606.35,420.668L7606.35,442.544C7606.35,452.602 7609.74,461.026 7616.53,467.815C7623.32,474.604 7632.87,479.004 7645.19,481.016L7712.33,492.708C7730.94,495.977 7745.46,502.515 7755.9,512.321C7766.33,522.128 7771.55,534.323 7771.55,548.907L7771.55,574.555C7771.55,592.157 7764.88,606.301 7751.56,616.987C7738.23,627.674 7720.5,633.017 7698.38,633.017L7655.38,633.017Z"/>
                      </g>
                    <g transform="matrix(0.0321415,0,0,-0.0321415,11511,1082.34)">
                          <path d="M2298.22,4774.45C2421.08,4788.55 2726.21,4786.53 2842.01,4771.43L2842.08,4771.42C3260.96,4715.03 3650.62,4547.85 3969.82,4288.07C4072.56,4204.47 4223.61,4051.39 4302.23,3949.62C4338.2,3904.65 4374.15,3858.71 4382.15,3848.72C4382.19,3848.66 4382.24,3848.61 4382.28,3848.55C4384.14,3846.15 4385.75,3844.12 4387.32,3842.49C4388.04,3841.73 4388.51,3840.97 4389.33,3840.73C4391.28,3840.13 4393.6,3840.91 4397.05,3841.75C4403.76,3843.38 4412.56,3846.39 4424.76,3850.65C4504.79,3880.34 4619.66,3880.95 4760.13,3852.24C4829.59,3837.94 4907.17,3816.26 4933.86,3802.96C5000.67,3770.57 5063.45,3705.97 5099.97,3630.85C5126.16,3577.41 5130.56,3557.54 5130.56,3480C5130.56,3400.53 5127.29,3383.81 5095.94,3321.1C5053.8,3234.78 5008.08,3193 4848.75,3101.51L4848.68,3101.47C4791.08,3068.77 4761.21,3051.84 4746.69,3039.51C4742.74,3036.16 4740.22,3033.95 4739.57,3031.15C4738.84,3028.05 4740.06,3024.91 4741.09,3020.77C4741.13,3020.63 4741.16,3020.48 4741.19,3020.34C4781.48,2837.04 4796.62,2525.84 4776.48,2327.43L4776.47,2327.38C4681.81,1424.07 4038.3,659.734 3166.2,415.023C2947.7,353.599 2842.98,340.451 2565.06,339.444L2565,339.444C2345.42,339.444 2297.06,342.544 2184.25,362.689C1676.86,454.302 1270.09,678.762 905.649,1067.36L851.85,1124.81L729.431,1113.51C340.929,1077.63 68.735,1197.01 1.08,1425.6C-53.104,1609.62 38.693,1835.49 271.784,2077.78L365.194,2174.96L354.727,2229.04L354.716,2229.1C336.574,2324.85 330.416,2660.48 343.519,2793.53L343.528,2793.62C387.837,3216.57 554.991,3621.39 822.851,3954.72C904.436,4057.44 1072.58,4224.58 1170.25,4303.12L1170.3,4303.16C1489.54,4557.95 1897.41,4728.13 2298.22,4774.45ZM2231.51,2323.84C2243.38,2316.11 2262.01,2304.39 2280.18,2294.8C2357.91,2254.99 2437.69,2247.95 2589.25,2264.46C2894.18,2300.22 3139.49,2385.76 3461.31,2568.52L3622.32,2660.53L3627.52,2712.51C3630.76,2748.02 3640.23,2786.42 3648.87,2799.36C3648.91,2799.42 3648.96,2799.48 3649,2799.54C3649.14,2799.74 3649.28,2799.94 3649.43,2800.14C3651.96,2803.32 3659.55,2810.06 3672.18,2818.83C3716.41,2849.57 3830.92,2919.78 3960.22,2994.47C4125.1,3089.77 4211.16,3138.53 4262.47,3156.55C4292.39,3167.06 4312.28,3167.68 4328.44,3162.44C4344.45,3157.25 4357.24,3145.91 4372.4,3129.59C4372.44,3129.54 4372.48,3129.49 4372.53,3129.45L4393.11,3106.74L4580.25,3214.49C4687.95,3276.32 4799.66,3341.13 4827.59,3359.09C4827.65,3359.13 4827.72,3359.17 4827.78,3359.21C4901.16,3404.85 4925.35,3481.24 4885.16,3541.22C4850.38,3591 4821.56,3604.98 4719.06,3624.72L4719,3624.74C4606.52,3646.85 4543.9,3648.71 4495.44,3631.4C4469.4,3619.31 4034.37,3371.41 3522.78,3076.53C3005.84,2777.56 2499.9,2484.6 2397.75,2426.51C2328.02,2386.18 2259.25,2341.92 2231.51,2323.84ZM422.984,1906.14C422.501,1905.66 422.025,1905.17 421.563,1904.69C387.051,1868.6 314.107,1773.27 283.36,1722.03C248.091,1662.6 226.646,1607.83 219.64,1560.35C213.087,1515.95 219.203,1478.32 239.493,1450.27C266.051,1415.29 333.498,1377.16 397.773,1361.09C397.868,1361.07 397.964,1361.04 398.059,1361.02C470.363,1341.48 613.009,1330.59 670.657,1339.38L692.601,1342.72L665.024,1384.42C664.982,1384.48 664.941,1384.55 664.9,1384.61C607.464,1474.29 492.58,1712.09 453.281,1826.97L453.242,1827.08C442.859,1858.23 430.145,1889.27 422.984,1906.14ZM2751.27,574.126C2751.02,575.606 2750.63,577.658 2750.15,579.352C2745.98,591.81 2739.6,636.648 2735.51,679.525L2735.51,679.592C2730.44,735.354 2721.88,770.964 2699.88,794.006C2677.93,816.989 2643.28,826.673 2589.04,833.568L2588.97,833.577C2494.05,846.093 2414.92,883.914 2358.58,945.433C2290.51,1018.75 2269.44,1074.21 2269.44,1180C2269.44,1286.76 2297.87,1357.87 2368,1428C2427.28,1487.28 2487.42,1514.75 2598.7,1531.38L2598.77,1531.4C2677.95,1542.84 2689.43,1547.52 2746.67,1590.44L2746.71,1590.48C2835.96,1656.9 2901.41,1680.56 3000,1680.56C3106.52,1680.56 3163.59,1658.27 3277.34,1572.44C3468.69,1429.43 3627.79,1267.27 3755.69,1087C3778.99,1054.1 3808.03,1020.64 3818.53,1008.77C3824.43,1013.2 3834.59,1021.04 3843.87,1029.28C3921.25,1097.95 4093.35,1276.65 4146.57,1347.36C4418.48,1708.58 4554.44,2114.45 4554.44,2563C4554.44,2667 4541.77,2833.88 4530.09,2902.57C4529.32,2907.09 4528.32,2911.71 4527.39,2915.69C4493.64,2898.84 4414.15,2851.21 4379.62,2827.06C4375.06,2823.86 4370.42,2820.19 4368.11,2818.32C4362.76,2793.14 4328.82,2607.05 4290.32,2387.31C4252.42,2172.51 4227.76,2046.16 4211.91,1983.49C4204.37,1953.65 4197.99,1936.99 4193.64,1930.93C4190.22,1926.17 4177.85,1915.72 4158.21,1901.99C4117.32,1873.4 4042.78,1826.72 3961.83,1779.56C3849.99,1714.28 3785.14,1678.74 3742.75,1663.94C3718.69,1655.54 3700.92,1653.48 3686.07,1655.69C3670.41,1658.02 3657.6,1664.98 3644.27,1675.86C3631.25,1686.28 3621.66,1694.84 3614.46,1707.7C3607.46,1720.2 3602.64,1737.02 3600.25,1764.79C3595.97,1814.47 3598.91,1903.01 3605.45,2076.55C3610.21,2217.66 3613.11,2340.46 3612.58,2386.65C3612.15,2386.46 3611.72,2386.27 3611.3,2386.08C3597.47,2379.81 3578.41,2369.69 3557.92,2357.61C3269.03,2185.49 2926.79,2069.76 2602.72,2034.54C2391.18,2011.04 2248.22,2035.22 2124.57,2114.93L2124.49,2114.98C2098.3,2132.1 1948.08,2274.92 1791.99,2431.01C1621.82,2601.78 1553.47,2670.55 1525.95,2707.28C1504.42,2736.02 1504.44,2748.18 1504.44,2768C1504.44,2804.45 1512.27,2825.37 1532.2,2844.2C1547.04,2858.74 1631.28,2910.54 1716.62,2959.61C1802.41,3008.94 1889.28,3055.48 1907.13,3060.07L1907.23,3060.09C1914.42,3061.89 1929.09,3060.97 1953.8,3054.28C2002.14,3041.19 2096.96,3006.64 2268.58,2940.52C2412.39,2885.39 2538.3,2837.93 2585.99,2821.15C2591.48,2819.22 2596.85,2817.46 2600.16,2816.39C2606.87,2819.66 2625.12,2828.65 2645.17,2839.43C2752.66,2897.27 2995.6,3035.63 3048.31,3070.01C3046.14,3071.8 3043.63,3073.77 3041.06,3075.55C3013.71,3094.55 2954.39,3127.35 2843.69,3186.27C2720.84,3251.63 2661.21,3284.39 2630.08,3306.83C2606.33,3323.95 2597.36,3336.16 2590.88,3350.47C2570.03,3394.56 2573.62,3430.54 2604.96,3468.85C2605.13,3469.06 2605.31,3469.26 2605.49,3469.46C2615.64,3480.64 2734.15,3555.28 2870.24,3633.48C2998.56,3707.52 3071.65,3746.94 3112.56,3763.97C3132.76,3772.37 3146.3,3775.56 3155,3775.56C3159.35,3775.56 3170.47,3773.42 3187.04,3768.84C3245.1,3752.82 3380.6,3707.41 3528.31,3653.62L3855.52,3535.08L4020.2,3629.46C4093.03,3672.08 4156.19,3710.28 4179.79,3727.05C4169.01,3742.4 4143.97,3777.55 4118.84,3809.3C4041.46,3905.52 3874.88,4071.15 3785.62,4138.59L3785.54,4138.65C3500.72,4356.98 3149.41,4500.89 2798.11,4544.56C2734.52,4552.15 2704.18,4557.21 2680.33,4550.09C2657,4543.13 2640.74,4524.2 2604.07,4487.07L2604,4487C2576.68,4459.68 2550.77,4429.51 2536.02,4408.84C2530.77,4401.48 2526.97,4395.73 2525.76,4392.08C2525.68,4391.85 2525.6,4391.62 2525.51,4391.39C2517.67,4371.1 2515.06,4351.23 2518.75,4308.2C2522.73,4261.82 2533.95,4190.44 2554.34,4068.57C2570.86,3969.9 2580.73,3905.05 2584.1,3859.09C2589.51,3785.21 2578.63,3756.97 2552.73,3720.06C2552.69,3720 2552.64,3719.93 2552.59,3719.87C2521.67,3677.22 2452.97,3646.96 2361.27,3639.5C2257.12,3630.97 2218.02,3614.57 2166.89,3553.97L2166.84,3553.91C2092.7,3466.88 2028.76,3442.42 1944.95,3464.98C1928.63,3469.39 1912.16,3477.43 1886.75,3497.36C1851.92,3524.67 1798.35,3575.86 1698.06,3674.94C1603.53,3768.6 1520.61,3846.89 1498.89,3864.1C1490.5,3862.63 1484.15,3856.16 1475.94,3841.17C1455.69,3804.17 1431.62,3725.82 1385.96,3565.73C1339.79,3404.13 1316.93,3324.59 1301.12,3281.18C1283.95,3234.04 1274.3,3226.22 1254.68,3207.69C1254.62,3207.63 1254.56,3207.57 1254.49,3207.52C1217.02,3173.28 1200.51,3159.13 1127.69,3152.18C1082.36,3147.85 1013.68,3146.46 900.286,3144.45C900.286,3144.45 647.15,3139.67 647.15,3139.67L622.084,3041.2C508.982,2590.75 563.534,2085.74 770.891,1673C814.463,1586.85 903.486,1437.3 940.122,1391.75C940.165,1391.7 940.208,1391.64 940.251,1391.59L951.941,1376.65L1056.04,1404.04L1056.14,1404.07C1366.59,1483.67 1695.94,1631.97 1985.47,1821.01C2088.08,1888.32 2140.62,1891.27 2185.86,1847.13C2185.91,1847.09 2185.95,1847.05 2186,1847C2216.81,1816.19 2227.94,1782.19 2221.26,1748.47C2214.89,1716.36 2191.54,1683.68 2150.03,1654.33C1891.72,1469.4 1453.53,1267.37 1133.93,1183.95C1133.85,1183.93 1133.77,1183.91 1133.69,1183.89C1133.69,1183.89 1116.28,1179.63 1116.28,1179.63L1185.74,1113.25C1489.36,823.523 1882.28,634.996 2298.03,580.424C2410.49,565.626 2700.5,560.17 2743.91,572.008C2744.2,572.088 2744.5,572.16 2744.8,572.223C2747.05,572.698 2749.59,573.531 2751.27,574.126ZM3836.05,1980.2C3851.43,1986.72 3879.4,1999.28 3907.18,2015.45C3907.25,2015.49 3907.33,2015.53 3907.4,2015.57C3946.9,2037.69 3981.45,2057.94 3995.47,2066.12C3996.29,2069.88 3997.47,2075.42 3998.64,2081.31C4021.79,2197.83 4118.7,2736.36 4132.76,2826.42C4129.98,2824.93 4127,2823.32 4124.03,2821.67C4063.84,2788.35 3918.22,2703.39 3866.07,2671.2C3859.11,2644.28 3852.52,2532.62 3845.55,2323.46C3839.95,2169.28 3836.28,2034.26 3836.05,1982.84C3836.05,1981.95 3836.05,1981.07 3836.05,1980.2ZM2939,3402.95C2967.86,3385.78 3037.48,3345.01 3109.16,3307.81L3109.27,3307.75L3292.69,3210.76L3445.25,3298.49C3500.51,3330.25 3556.49,3365.62 3583.62,3383.01C3549.38,3398.14 3477.5,3426.2 3394.67,3456.38C3300.61,3490.66 3215.47,3520.49 3181.1,3531.04C3177.17,3532.25 3173.09,3533.36 3170.7,3533.99C3167.61,3532.7 3160.58,3529.72 3153.67,3526.33C3105.55,3502.64 2997.53,3441.19 2947.72,3408.86C2944.73,3406.92 2941.75,3404.89 2939,3402.95ZM2054.35,2497.92C2060.27,2500.99 2069.81,2505.99 2080.29,2511.73C2146.26,2547.85 2288.77,2628.66 2344.93,2662.31C2314.13,2674.75 2259.48,2696.17 2197.41,2720.48C2099.54,2757.43 1999.7,2796.38 1974.73,2805.36C1974.56,2805.43 1974.39,2805.49 1974.22,2805.56C1974.22,2805.56 1936.32,2820.72 1936.32,2820.72L1864.9,2778.6C1864.84,2778.56 1864.77,2778.52 1864.7,2778.48L1803.42,2743.58L1922,2625C1982.18,2564.82 2034.9,2513.94 2054.35,2497.92Z"/>
                      </g>
                  </g>
              </g>
            </svg>
            <div className="contacts">
              <span><i className="material-symbols-outlined">language</i>www.megatours.am</span>
              <span><i className="material-symbols-outlined">mail</i>bookings@megatours.am</span>
              <span><i className="material-symbols-outlined">phone_in_talk</i>(+374 55) 65-99-65</span>
            </div>
          </div>
          <div>
            <h1>{t.profile.voucher.title}</h1>
            <p className="voucher-subtitle">{t.profile.voucher.subtitle}</p>
          </div>
          <div className="voucher-meta">
            <div className={`status-chip status-${statusKey}`}>
              <span>{statusLabel}</span>
            </div>
            <div className="voucher-meta-line">
              <span>{t.profile.bookings.labels.bookingId}</span>
              <strong>{payload.customerRefNumber ?? "—"}</strong>
            </div>
            <div className="voucher-meta-line">
              <span>{t.profile.bookings.labels.confirmation}</span>
              <strong>{confirmation}</strong>
            </div>
            <div className="voucher-meta-line">
              <span>{t.profile.voucher.issuedOn}</span>
              <strong>{issuedOn}</strong>
            </div>
          </div>
        </div>

        <VoucherActions
          downloadLabel={t.profile.voucher.downloadPdf}
          backLabel={t.profile.voucher.backToProfile}
          profileHref={`/${resolvedLocale}/profile`}
        />

        {canManageAddons ? (
          <section className="voucher-card voucher-card--addons">
            <h2>{t.profile.voucher.sections.services}</h2>
            <p>
              {missingAddonServices.join(", ")}
            </p>
            <Link href={manageAddonsHref} className="service-builder__cta">
              {t.packageBuilder.checkoutButton}
            </Link>
          </section>
        ) : null}

        <section className="voucher-grid">
          <div className="voucher-card">
            <h2>{t.profile.voucher.sections.stay}</h2>
            <div className="voucher-definition">
              <div>
                <span>{t.profile.bookings.labels.hotelName}</span>
                <strong>{payload.hotelName ?? payload.hotelCode ?? "—"}</strong>
              </div>
              <div>
                <span>{t.profile.searches.labels.dates}</span>
                <strong>{dateRange ?? "—"}</strong>
              </div>
              <div>
                <span>{t.profile.bookings.labels.rooms}</span>
                <strong>{roomsCount}</strong>
              </div>
              <div>
                <span>{t.profile.bookings.labels.guests}</span>
                <strong>{guestsCount}</strong>
              </div>
              {nights ? (
                <div>
                  <span>{t.common.night.other}</span>
                  <strong>{nights}</strong>
                </div>
              ) : null}
              {destinationLabel ? (
                <div>
                  <span>{t.profile.bookings.labels.destination}</span>
                  <strong>{destinationLabel}</strong>
                </div>
              ) : null}
            </div>
          </div>

          <div className="voucher-card">
            <h2>{t.profile.voucher.sections.payment}</h2>
            <div className="voucher-total">
              <div>
                <span>{t.profile.bookings.labels.total}:</span>
                <strong>{totalLabel}</strong>
              </div>
              <div>
                <span>{t.packageBuilder.checkout.paymentTitle}:</span>
                <span>{paymentMethodLabel}</span>
              </div>
              {appliedCoupon ? (
                <div>
                  <span>{t.packageBuilder.checkout.couponTitle}:</span>
                  <span>
                    {appliedCoupon.code} ({appliedCoupon.discountPercent}%)
                  </span>
                </div>
              ) : null}
              <p>{t.profile.voucher.paymentNote}</p>
            </div>
          </div>
        </section>
        {showBookingUpdates && (
          <>
            <h2>{t.profile.voucher.sections.updates}</h2>
            <section className="voucher-card">
              <div className="voucher-definition">
                {bookingCanceledByAdmin ? (
                  <div>
                    <span>{t.profile.voucher.updates.bookingStatus}</span>
                    <strong>{t.profile.voucher.updates.canceled}</strong>
                  </div>
                ) : null}
                {canceledOnLabel ? (
                  <div>
                    <span>{t.profile.voucher.updates.canceledOn}</span>
                    <strong>{canceledOnLabel}</strong>
                  </div>
                ) : null}
                {refundStatusLabel ? (
                  <div>
                    <span>{t.profile.voucher.updates.refundStatus}</span>
                    <strong>{refundStatusLabel}</strong>
                  </div>
                ) : null}
                {refundedAmountLabel ? (
                  <div>
                    <span>{t.profile.voucher.updates.refundedAmount}</span>
                    <strong>{refundedAmountLabel}</strong>
                  </div>
                ) : null}
                {refundedServicesLabel ? (
                  <div>
                    <span>{t.profile.voucher.updates.refundedServices}</span>
                    <strong>{refundedServicesLabel}</strong>
                  </div>
                ) : null}
              </div>
            </section>
          </>
        )}
        <h2>{t.profile.voucher.sections.services}</h2>
        <section className="voucher-card voucher-card--services">
          <div className="voucher-services">
            {serviceCards.map((service) => (
              <fieldset key={service.id} className="voucher-service">
                <legend>{service.title}</legend>
                <ul className="voucher-service__details">
                  {service.details.length > 0 ? (
                    service.details.map((detail, index) => (
                      <li key={`${service.id}-${index}`}>{detail}</li>
                    ))
                  ) : (
                    <li>{t.packageBuilder.checkout.pendingDetails}</li>
                  )}
                </ul>
                <span className="voucher-service__price">{service.price}</span>
              </fieldset>
            ))}
          </div>
        </section>
        <h2>{t.profile.voucher.sections.guests}</h2>
        <section className="voucher-card voucher-card--guests">
          <div className="voucher-rooms">
            {payload.rooms.map((room, index) => (
              <div key={room.roomIdentifier} className="voucher-room">
                <div className="voucher-room__header">
                  <h3>
                    {t.packageBuilder.checkout.guestRoomLabel} {index + 1}
                  </h3>
                  <span>
                    {room.adults} {t.search.adultsLabel}
                    {room.childrenAges.length ? ` • ${room.childrenAges.length} ${t.search.childrenLabel}` : ""}
                  </span>
                </div>
                <ul className="voucher-guest-list">
                  {room.guests.map((guest, guestIndex) => (
                    <li key={`${room.roomIdentifier}-${guestIndex}`}>
                      <div>
                        <strong>
                          {guest.firstName} {guest.lastName}
                        </strong>
                        <span>
                          {guest.type === "Adult"
                            ? t.packageBuilder.checkout.guestAdultLabel
                            : t.packageBuilder.checkout.guestChildLabel}
                          {" • "}
                          {t.packageBuilder.checkout.ageLabel}: {guest.age}
                        </span>
                      </div>
                      {guest.isLeadGuest ? (
                        <span className="voucher-lead">{t.packageBuilder.checkout.guestLeadLabel}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
        <h2>{t.profile.voucher.sections.notes}</h2>
        <section className="voucher-card voucher-card--notes">
          <p>{t.profile.voucher.notes}</p>
        </section>
      </div>
    </main>
  );
}
