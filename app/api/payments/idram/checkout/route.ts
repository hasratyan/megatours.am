import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import type { Collection, Document } from "mongodb";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getPrebookState, getSessionFromCookie, type StoredPrebookState } from "@/app/api/aoryx/_shared";
import { parseBookingPayload, validatePrebookState } from "@/lib/aoryx-booking";
import { calculateBookingTotal } from "@/lib/booking-total";
import { applyMarkup } from "@/lib/pricing-utils";
import { convertToAmd, getAmdRates, getAoryxHotelPlatformFee } from "@/lib/pricing";
import {
  applyCouponPercentDiscount,
  normalizeCouponCode,
  validateCouponForCheckout,
  type CouponValidationFailureReason,
} from "@/lib/coupons";
import { getPaymentMethodFlags } from "@/lib/payment-method-flags";
import type { AoryxBookingPayload } from "@/types/aoryx";

export const runtime = "nodejs";

const IDRAM_ACTION = "https://banking.idram.am/Payment/GetPayment";
const DEFAULT_LANGUAGE = "EN";
const DUPLICATE_ATTEMPT_STATUSES = [
  "booking_complete",
  "booking_in_progress",
  "payment_success",
  "created",
  "prechecked",
] as const;
const ACTIVE_CREATED_ATTEMPT_TTL_MS = 20 * 60 * 1000;
const DUPLICATE_ATTEMPT_LOOKUP_LIMIT = 20;

type BlockingIdramAttempt = {
  billNo?: string;
  status?: string;
  createdAt?: Date | string | number | null;
  updatedAt?: Date | string | number | null;
};

const resolveString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const parseSessionId = (input: unknown): string | undefined => {
  if (typeof input !== "string") return undefined;
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const buildBillNo = () => {
  const suffix = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  return `${Date.now()}${suffix}`;
};

const formatAmount = (value: number) => value.toFixed(2);

const normalizeLanguage = (value: string | undefined) => {
  const normalized = (value ?? DEFAULT_LANGUAGE).trim().toUpperCase();
  if (normalized === "AM" || normalized === "RU" || normalized === "EN") return normalized;
  return DEFAULT_LANGUAGE;
};

const toDate = (value: unknown): Date | null => {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }
  return null;
};

const hashForFingerprint = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

const resolveBookingRateKeyHashes = (
  payload: AoryxBookingPayload,
  prebookState: StoredPrebookState | null
): string[] => {
  if (Array.isArray(prebookState?.rateKeyHashes) && prebookState.rateKeyHashes.length > 0) {
    return [...prebookState.rateKeyHashes]
      .map((hash) => resolveString(hash))
      .filter((hash) => hash.length > 0)
      .sort();
  }

  if (Array.isArray(prebookState?.rateKeys) && prebookState.rateKeys.length > 0) {
    return [...prebookState.rateKeys]
      .map((key) => resolveString(key))
      .filter((key) => key.length > 0)
      .map(hashForFingerprint)
      .sort();
  }

  return payload.rooms
    .map((room) => resolveString(room.rateKey))
    .filter((key) => key.length > 0)
    .map(hashForFingerprint)
    .sort();
};

const buildBookingFingerprint = (
  payload: AoryxBookingPayload,
  rateKeyHashes: string[]
) => {
  const fingerprintPayload = JSON.stringify({
    sessionId: payload.sessionId,
    hotelCode: payload.hotelCode,
    groupCode: payload.groupCode,
    checkInDate: payload.checkInDate ?? "",
    checkOutDate: payload.checkOutDate ?? "",
    rateKeyHashes,
  });
  return hashForFingerprint(fingerprintPayload);
};

const isBlockingAttempt = (record: BlockingIdramAttempt): boolean => {
  const status = resolveString(record.status).toLowerCase();
  if (status === "booking_complete" || status === "booking_in_progress" || status === "payment_success") {
    return true;
  }
  if (status === "created" || status === "prechecked") {
    const lastUpdatedAt = toDate(record.updatedAt) ?? toDate(record.createdAt);
    if (!lastUpdatedAt) return false;
    return Date.now() - lastUpdatedAt.getTime() <= ACTIVE_CREATED_ATTEMPT_TTL_MS;
  }
  return false;
};

const findBlockingAttempt = async (
  collection: Collection<Document>,
  bookingFingerprint: string,
  payload: AoryxBookingPayload
): Promise<BlockingIdramAttempt | null> => {
  const statusFilter = { $in: [...DUPLICATE_ATTEMPT_STATUSES] };
  const projection = {
    _id: 0,
    billNo: 1,
    status: 1,
    createdAt: 1,
    updatedAt: 1,
  };
  const sort = { updatedAt: -1, createdAt: -1 } as const;

  const byFingerprint = (await collection
    .find({ bookingFingerprint, status: statusFilter }, { projection })
    .sort(sort)
    .limit(DUPLICATE_ATTEMPT_LOOKUP_LIMIT)
    .toArray()) as BlockingIdramAttempt[];

  for (const attempt of byFingerprint) {
    if (isBlockingAttempt(attempt)) return attempt;
  }

  const legacyMatch = (await collection
    .find(
      {
        "payload.sessionId": payload.sessionId,
        "payload.hotelCode": payload.hotelCode,
        "payload.groupCode": payload.groupCode,
        status: statusFilter,
      },
      { projection }
    )
    .sort(sort)
    .limit(DUPLICATE_ATTEMPT_LOOKUP_LIMIT)
    .toArray()) as BlockingIdramAttempt[];

  for (const attempt of legacyMatch) {
    if (isBlockingAttempt(attempt)) return attempt;
  }

  return null;
};

const duplicateAttemptMessage = (attempt: BlockingIdramAttempt): string => {
  const status = resolveString(attempt.status).toLowerCase();
  if (status === "booking_complete") {
    return "This prebook session is already booked. Please check your confirmed bookings.";
  }
  if (status === "booking_in_progress" || status === "payment_success") {
    return "A payment for this prebook session is already being finalized. Please wait and check the booking status.";
  }
  return "A payment attempt for this prebook session is already active. Please complete it or wait a few minutes before retrying.";
};

const couponValidationFailureToResponse = (reason: CouponValidationFailureReason) => {
  if (reason === "invalid_format" || reason === "not_found") {
    return { status: 400, error: "Coupon is invalid.", code: "invalid_coupon" };
  }
  if (reason === "disabled") {
    return { status: 400, error: "Coupon is disabled.", code: "coupon_disabled" };
  }
  if (reason === "scheduled") {
    return { status: 400, error: "Coupon is not active yet.", code: "coupon_not_started" };
  }
  if (reason === "expired") {
    return { status: 400, error: "Coupon has expired.", code: "coupon_expired" };
  }
  if (reason === "limit_reached") {
    return {
      status: 400,
      error: "Coupon usage limit has been reached.",
      code: "coupon_limit_reached",
    };
  }
  return {
    status: 400,
    error: "Coupon is temporarily disabled.",
    code: "coupon_temporarily_disabled",
  };
};

export async function POST(request: NextRequest) {
  try {
    const paymentMethodFlags = await getPaymentMethodFlags();
    if (paymentMethodFlags.idram === false) {
      return NextResponse.json(
        {
          error: "Idram payments are currently disabled.",
          code: "payment_method_disabled",
        },
        { status: 403 }
      );
    }

    const body = await request.json();
    const locale =
      typeof (body as { locale?: unknown }).locale === "string"
        ? (body as { locale?: string }).locale?.trim()
        : null;
    const sessionId =
      parseSessionId((body as { sessionId?: unknown }).sessionId) ??
      getSessionFromCookie(request);

    let payload: AoryxBookingPayload;
    try {
      payload = parseBookingPayload(body, sessionId);
    } catch (parseError) {
      const message = parseError instanceof Error ? parseError.message : "Invalid booking payload";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const prebookState = getPrebookState(request);
    try {
      validatePrebookState(prebookState, payload);
    } catch (validationError) {
      const message =
        validationError instanceof Error ? validationError.message : "Rate selection changed. Please prebook again.";
      return NextResponse.json({ error: message }, { status: 409 });
    }

    const couponCode = normalizeCouponCode((body as { couponCode?: unknown }).couponCode);
    let couponDetails: { code: string; discountPercent: number } | null = null;
    if (couponCode) {
      const validation = await validateCouponForCheckout(couponCode);
      if (!validation.ok) {
        const response = couponValidationFailureToResponse(validation.reason);
        return NextResponse.json(
          { error: response.error, code: response.code },
          { status: response.status }
        );
      }
      couponDetails = {
        code: validation.coupon.code,
        discountPercent: validation.coupon.discountPercent,
      };
    }

    const recAccount = typeof process.env.IDRAM_REC_ACCOUNT === "string"
      ? process.env.IDRAM_REC_ACCOUNT.trim()
      : "";
    if (!recAccount) {
      return NextResponse.json(
        { error: "Idram is not configured. Please contact support." },
        { status: 500 }
      );
    }

    const db = await getDb();
    const idramCollection = db.collection("idram_payments");
    const bookingRateKeyHashes = resolveBookingRateKeyHashes(payload, prebookState);
    const bookingFingerprint = buildBookingFingerprint(payload, bookingRateKeyHashes);
    const blockingAttempt = await findBlockingAttempt(idramCollection, bookingFingerprint, payload);
    if (blockingAttempt) {
      return NextResponse.json(
        {
          error: duplicateAttemptMessage(blockingAttempt),
          code: "duplicate_payment_attempt",
          existingPayment: {
            provider: "idram",
            status: resolveString(blockingAttempt.status) || null,
            billNo: resolveString(blockingAttempt.billNo) || null,
          },
        },
        { status: 409 }
      );
    }

    const hotelMarkup = await getAoryxHotelPlatformFee();
    const baseAmount = calculateBookingTotal(payload, { hotelMarkup });
    if (!Number.isFinite(baseAmount) || baseAmount <= 0) {
      return NextResponse.json({ error: "Invalid booking total." }, { status: 400 });
    }

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
    const transferTotal =
      typeof payload.transferSelection?.totalPrice === "number" &&
      Number.isFinite(payload.transferSelection.totalPrice)
        ? payload.transferSelection.totalPrice
        : 0;
    const excursionsTotal =
      typeof payload.excursions?.totalAmount === "number" &&
      Number.isFinite(payload.excursions.totalAmount)
        ? payload.excursions.totalAmount
        : 0;
    const insuranceTotal =
      typeof payload.insurance?.price === "number" && Number.isFinite(payload.insurance.price)
        ? payload.insurance.price
        : 0;
    const flightsTotal =
      typeof payload.airTickets?.price === "number" && Number.isFinite(payload.airTickets.price)
        ? payload.airTickets.price
        : 0;

    let amountValue = baseAmount;
    let amountCurrency = payload.currency;

    try {
      const rates = await getAmdRates();
      const convertAmount = (
        amount: number,
        currency: string | null | undefined,
        ratesValue: typeof rates
      ) => {
        if (!Number.isFinite(amount) || amount <= 0) return 0;
        const converted = convertToAmd(amount, currency, ratesValue);
        if (converted === null) {
          throw new Error("Missing exchange rate");
        }
        return converted;
      };
      const transferCurrency = payload.transferSelection?.pricing?.currency ?? payload.currency;
      const excursionsCurrency = payload.excursions?.selections?.[0]?.currency ?? payload.currency;
      const insuranceCurrency = payload.insurance?.currency ?? payload.currency;
      const flightsCurrency = payload.airTickets?.currency ?? payload.currency;
      const totalAmd =
        convertAmount(roomsTotalWithMarkup, payload.currency, rates) +
        convertAmount(transferTotal, transferCurrency, rates) +
        convertAmount(excursionsTotal, excursionsCurrency, rates) +
        convertAmount(insuranceTotal, insuranceCurrency, rates) +
        convertAmount(flightsTotal, flightsCurrency, rates);
      amountValue = Math.round(totalAmd);
      amountCurrency = "AMD";
    } catch (error) {
      console.error("[Idram][checkout] Failed to convert amount", error);
      return NextResponse.json(
        { error: "Failed to calculate AMD total. Please try again." },
        { status: 500 }
      );
    }

    const couponAmountBreakdown =
      couponDetails && amountValue > 0
        ? (() => {
            const amounts = applyCouponPercentDiscount(amountValue, couponDetails.discountPercent);
            return {
              code: couponDetails.code,
              discountPercent: couponDetails.discountPercent,
              discountAmount: amounts.discountAmount,
              discountedAmount: amounts.discountedAmount,
            };
          })()
        : null;

    if (couponAmountBreakdown) {
      amountValue = couponAmountBreakdown.discountedAmount;
    }

    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      return NextResponse.json({ error: "Invalid booking total." }, { status: 400 });
    }

    const amountFormatted = formatAmount(amountValue);
    const billNo = buildBillNo();
    const language = normalizeLanguage(process.env.IDRAM_LANGUAGE);
    const description = `Booking ${payload.hotelCode} (${payload.customerRefNumber})`;

    const session = await getServerSession(authOptions);
    const userId = session?.user?.id ?? null;
    const userEmail = session?.user?.email ?? null;
    const userName = session?.user?.name ?? null;

    const now = new Date();

    await idramCollection.insertOne({
      billNo,
      status: "created",
      bookingFingerprint,
      bookingKey: {
        sessionId: payload.sessionId,
        hotelCode: payload.hotelCode,
        groupCode: payload.groupCode,
        rateKeyHashes: bookingRateKeyHashes,
      },
      recAccount,
      amount: {
        value: amountValue,
        formatted: amountFormatted,
        currency: amountCurrency,
        baseValue: baseAmount,
        baseCurrency: payload.currency,
        discount: couponAmountBreakdown,
      },
      description,
      payload,
      prebookState,
      coupon: couponAmountBreakdown,
      userId,
      userEmail,
      userName,
      locale,
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json({
      action: IDRAM_ACTION,
      billNo,
      fields: {
        EDP_LANGUAGE: language,
        EDP_REC_ACCOUNT: recAccount,
        EDP_DESCRIPTION: description,
        EDP_AMOUNT: amountFormatted,
        EDP_BILL_NO: billNo,
        ...(userEmail ? { EDP_EMAIL: userEmail } : {}),
      },
    });
  } catch (error) {
    console.error("[Idram][checkout] Failed to initialize payment", error);
    return NextResponse.json(
      { error: "Failed to initialize payment" },
      { status: 500 }
    );
  }
}
