import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { ObjectId, type Collection, type Document } from "mongodb";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getPrebookState, getSessionFromCookie, type StoredPrebookState } from "@/app/api/aoryx/_shared";
import { parseBookingPayload, validatePrebookState } from "@/lib/aoryx-booking";
import { calculateBookingTotal } from "@/lib/booking-total";
import { applyMarkup } from "@/lib/pricing-utils";
import { getAmdRateForCurrency, getAmdRates, getAoryxHotelPlatformFee } from "@/lib/pricing";
import {
  applyCouponPercentDiscount,
  normalizeCouponCode,
  validateCouponForCheckout,
  type CouponValidationFailureReason,
} from "@/lib/coupons";
import { getPaymentMethodFlags } from "@/lib/payment-method-flags";
import { getServiceFlags } from "@/lib/service-flags";
import { DEFAULT_SERVICE_FLAGS } from "@/lib/package-builder-state";
import { validateTransferFlightDetailsForBooking } from "@/lib/b2b-service-booking";
import {
  calculateBookingAddonAmountAmd,
  isBookingCanceled,
  isBookingConfirmed,
  mergeBookingAddonPayload,
  parseBookingAddonCheckoutRequest,
  resolveExistingBookingAddonServiceKeys,
  type BookingAddonCheckoutRequest,
  type BookingAddonServiceKey,
} from "@/lib/booking-addons";
import type { AoryxBookingPayload, AoryxBookingResult } from "@/types/aoryx";

export const runtime = "nodejs";

type PaymentProvider = "idbank" | "ameriabank";

type VposInitResult = {
  orderId: string;
  orderNumber: string;
  formUrl: string;
  gatewayMeta: Record<string, unknown>;
};

type AmeriaInitResponse = {
  PaymentID?: string;
  ResponseCode?: number | string;
  ResponseMessage?: string;
};

type BlockingVposAttempt = {
  provider?: string;
  orderId?: string;
  orderNumber?: string;
  status?: string;
  createdAt?: Date | string | number | null;
  updatedAt?: Date | string | number | null;
};

type UserBookingRecord = {
  _id: ObjectId;
  userIdString?: string | null;
  payload?: AoryxBookingPayload | null;
  booking?: AoryxBookingResult | null;
};

type BlockingAddonAttempt = {
  provider?: string;
  orderId?: string;
  orderNumber?: string;
  status?: string;
  createdAt?: Date | string | number | null;
  updatedAt?: Date | string | number | null;
  addon?: {
    serviceKeys?: BookingAddonServiceKey[];
  };
};

const IDBANK_DEFAULT_BASE_URL = "https://ipaytest.arca.am:8445/payment/rest";
const AMERIA_DEFAULT_BASE_URL = "https://servicestest.ameriabank.am/VPOS";
const DEFAULT_CURRENCY_CODE = "051";
const DEFAULT_CURRENCY_DECIMALS = 2;
const DEFAULT_LANGUAGE = "en";
const AMERIA_TEST_ORDER_ID_MIN = 4191001;
const AMERIA_TEST_ORDER_ID_MAX = 4192000;
const AMERIA_DEFAULT_TEST_AMOUNT_AMD = 10;
const AMERIA_MAX_INIT_RETRIES = 6;
const VPOS_PUBLIC_ORIGIN = "https://megatours.am";
const DUPLICATE_ATTEMPT_STATUSES = [
  "booking_complete",
  "booking_in_progress",
  "payment_success",
  "created",
] as const;
const ACTIVE_CREATED_ATTEMPT_TTL_MS = 20 * 60 * 1000;
const DUPLICATE_ATTEMPT_LOOKUP_LIMIT = 20;
const ADDON_ACTIVE_ATTEMPT_STATUSES = ["created", "payment_success", "booking_in_progress"] as const;

const normalizeBaseUrl = (value: string) => value.trim().replace(/\/+$/, "");

const resolveString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const normalizeOrigin = (value: string | null | undefined): string | null => {
  const trimmed = resolveString(value);
  if (!trimmed) return null;
  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
};

const resolvePublicOrigin = (request: NextRequest): string => {
  const explicitOrigin = normalizeOrigin(process.env.VPOS_PUBLIC_ORIGIN);
  if (explicitOrigin) return explicitOrigin;

  const forwardedHost = resolveString(request.headers.get("x-forwarded-host")).split(",")[0]?.trim() ?? "";
  const forwardedProto = resolveString(request.headers.get("x-forwarded-proto")).split(",")[0]?.trim() ?? "";
  if (forwardedHost) {
    const protocol = forwardedProto || request.nextUrl.protocol.replace(":", "") || "https";
    const forwardedOrigin = normalizeOrigin(`${protocol}://${forwardedHost}`);
    if (forwardedOrigin) return forwardedOrigin;
  }

  const requestOrigin = normalizeOrigin(request.nextUrl.origin);
  if (requestOrigin) return requestOrigin;

  const siteOrigin = normalizeOrigin(process.env.NEXT_PUBLIC_SITE_URL ?? process.env.NEXTAUTH_URL);
  if (siteOrigin) return siteOrigin;

  if (process.env.NODE_ENV !== "production") return "http://localhost:3000";
  return VPOS_PUBLIC_ORIGIN;
};

const parseSessionId = (input: unknown): string | undefined => {
  if (typeof input !== "string") return undefined;
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const parsePaymentProvider = (input: unknown): PaymentProvider => {
  const normalized = resolveString(input).toLowerCase();
  if (normalized === "ameriabank" || normalized === "ameria") return "ameriabank";
  return "idbank";
};

const normalizeLanguage = (value: string | undefined) => {
  const normalized = (value ?? DEFAULT_LANGUAGE).trim().toLowerCase();
  if (normalized === "hy" || normalized === "ru" || normalized === "en") return normalized;
  return DEFAULT_LANGUAGE;
};

const resolveAmeriaLanguage = (value: string) => {
  if (value === "hy") return "am";
  if (value === "ru") return "ru";
  return "en";
};

const resolveCurrencyDecimals = (value: string | undefined) => {
  const parsed = Number.parseInt((value ?? "").trim(), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_CURRENCY_DECIMALS;
};

const normalizeCurrencyCode = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const upper = trimmed.toUpperCase();
  if (upper === "AMD") return "051";
  if (upper === "USD") return "840";
  if (upper === "EUR") return "978";
  if (upper === "RUB") return "643";
  if (/^\d+$/.test(trimmed)) return trimmed.padStart(3, "0");
  return trimmed;
};

const toMinorUnits = (amount: number, decimals: number) =>
  Math.round(amount * Math.pow(10, decimals));

const resolvePositiveNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
};

const buildOrderNumber = (value: string | null | undefined) => {
  const suffix = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  const fallback = `MEGA-${Date.now()}${suffix}`;
  const raw = (value ?? "").trim();
  const candidate = raw.length > 0 ? raw : fallback;
  return candidate.length > 32 ? candidate.slice(0, 32) : candidate;
};

const sanitizeDescription = (value: string) =>
  value.replace(/[%+\r\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 99);

const resolvePageView = (userAgent: string | null) =>
  /Mobi|Android|iPhone|iPad|iPod/i.test(userAgent ?? "") ? "MOBILE" : "DESKTOP";

const buildReturnUrl = (request: NextRequest) =>
  new URL("/api/payments/vpos/result", resolvePublicOrigin(request)).toString();

const resolveCurrencyConfig = (provider: PaymentProvider) => {
  if (provider === "ameriabank") {
    const rawCode = resolveString(process.env.AMERIA_VPOS_CURRENCY_CODE) || DEFAULT_CURRENCY_CODE;
    const code = normalizeCurrencyCode(rawCode);
    const decimals = resolveCurrencyDecimals(process.env.AMERIA_VPOS_CURRENCY_DECIMALS);
    return { code, decimals };
  }

  const rawCode =
    typeof process.env.VPOS_CURRENCY_CODE === "string" && process.env.VPOS_CURRENCY_CODE.trim()
      ? process.env.VPOS_CURRENCY_CODE.trim()
      : DEFAULT_CURRENCY_CODE;
  const code = normalizeCurrencyCode(rawCode);
  const decimals = resolveCurrencyDecimals(process.env.VPOS_CURRENCY_DECIMALS);
  return { code, decimals };
};

const resolveIdbankConfig = () => {
  const baseUrl = normalizeBaseUrl(resolveString(process.env.VPOS_BASE_URL) || IDBANK_DEFAULT_BASE_URL);
  const userName = resolveString(process.env.VPOS_USER);
  const password = resolveString(process.env.VPOS_PASSWORD);
  return { baseUrl, userName, password };
};

const resolveAmeriaConfig = () => {
  const baseUrl = normalizeBaseUrl(
    resolveString(process.env.AMERIA_VPOS_BASE_URL) || AMERIA_DEFAULT_BASE_URL
  );
  const clientId = resolveString(process.env.AMERIA_VPOS_CLIENT_ID);
  const userName = resolveString(process.env.AMERIA_VPOS_USERNAME);
  const password = resolveString(process.env.AMERIA_VPOS_PASSWORD);
  const timeoutRaw = Number.parseInt(resolveString(process.env.AMERIA_VPOS_TIMEOUT) || "", 10);
  const timeout = Number.isFinite(timeoutRaw) && timeoutRaw > 0
    ? Math.min(timeoutRaw, 1200)
    : 1200;
  return { baseUrl, clientId, userName, password, timeout };
};

const isAmeriaTestEnvironment = (baseUrl: string) =>
  /servicestest\.ameriabank\.am/i.test(baseUrl);

const resolveAmeriaOrderRange = (baseUrl: string): { min: number; max: number } | null => {
  const minRaw = Number.parseInt(resolveString(process.env.AMERIA_VPOS_TEST_ORDER_ID_MIN), 10);
  const maxRaw = Number.parseInt(resolveString(process.env.AMERIA_VPOS_TEST_ORDER_ID_MAX), 10);

  if (Number.isFinite(minRaw) && Number.isFinite(maxRaw) && minRaw > 0 && maxRaw >= minRaw) {
    return { min: minRaw, max: maxRaw };
  }

  if (isAmeriaTestEnvironment(baseUrl)) {
    return { min: AMERIA_TEST_ORDER_ID_MIN, max: AMERIA_TEST_ORDER_ID_MAX };
  }

  return null;
};

const resolveAmeriaOverrideAmount = (baseUrl: string): number | null => {
  const explicitAmount = resolvePositiveNumber(process.env.AMERIA_VPOS_TEST_AMOUNT_AMD);
  if (explicitAmount !== null) return explicitAmount;

  const forceRaw = resolveString(process.env.AMERIA_VPOS_FORCE_TEST_AMOUNT).toLowerCase();
  if (forceRaw === "false" || forceRaw === "0" || forceRaw === "no") {
    return null;
  }

  if (isAmeriaTestEnvironment(baseUrl)) {
    return AMERIA_DEFAULT_TEST_AMOUNT_AMD;
  }

  return null;
};

const buildAmeriaOrderId = (
  customerRefNumber: string | null | undefined,
  range: { min: number; max: number } | null,
  attempt: number
): number => {
  const refDigits = (customerRefNumber ?? "").replace(/\D+/g, "");

  if (range) {
    const span = range.max - range.min + 1;
    if (span <= 0) {
      return range.min;
    }

    if (refDigits.length > 0) {
      const refNumber = Number.parseInt(refDigits.slice(-10), 10);
      if (Number.isFinite(refNumber)) {
        const offset = (refNumber + attempt) % span;
        return range.min + offset;
      }
    }

    const seed = Date.now() + Math.floor(Math.random() * span) + attempt;
    return range.min + (seed % span);
  }

  if (refDigits.length > 0) {
    const parsed = Number.parseInt(refDigits.slice(-9), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed + attempt;
    }
  }

  const fallback = Number.parseInt(String(Date.now()).slice(-9), 10);
  if (Number.isFinite(fallback) && fallback > 0) {
    return fallback + attempt;
  }
  return 1 + attempt;
};

const extractJsonResponse = async (response: Response): Promise<Record<string, unknown> | null> => {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
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

const isBlockingAttempt = (record: BlockingVposAttempt): boolean => {
  const status = resolveString(record.status).toLowerCase();
  if (status === "booking_complete" || status === "booking_in_progress" || status === "payment_success") {
    return true;
  }
  if (status === "created") {
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
): Promise<BlockingVposAttempt | null> => {
  const statusFilter = { $in: [...DUPLICATE_ATTEMPT_STATUSES] };
  const projection = {
    _id: 0,
    provider: 1,
    orderId: 1,
    orderNumber: 1,
    status: 1,
    createdAt: 1,
    updatedAt: 1,
  };
  const sort = { updatedAt: -1, createdAt: -1 } as const;

  const byFingerprint = (await collection
    .find({ bookingFingerprint, status: statusFilter }, { projection })
    .sort(sort)
    .limit(DUPLICATE_ATTEMPT_LOOKUP_LIMIT)
    .toArray()) as BlockingVposAttempt[];

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
    .toArray()) as BlockingVposAttempt[];

  for (const attempt of legacyMatch) {
    if (isBlockingAttempt(attempt)) return attempt;
  }

  return null;
};

const duplicateAttemptMessage = (attempt: BlockingVposAttempt): string => {
  const status = resolveString(attempt.status).toLowerCase();
  if (status === "booking_complete") {
    return "This prebook session is already booked. Please check your confirmed bookings.";
  }
  if (status === "booking_in_progress" || status === "payment_success") {
    return "A payment for this prebook session is already being finalized. Please wait and check the booking status.";
  }
  return "A payment attempt for this prebook session is already active. Please complete it or wait a few minutes before retrying.";
};

const isBlockingAddonAttempt = (record: BlockingAddonAttempt): boolean => {
  const status = resolveString(record.status).toLowerCase();
  if (status === "booking_in_progress" || status === "payment_success") {
    return true;
  }
  if (status === "created") {
    const lastUpdatedAt = toDate(record.updatedAt) ?? toDate(record.createdAt);
    if (!lastUpdatedAt) return false;
    return Date.now() - lastUpdatedAt.getTime() <= ACTIVE_CREATED_ATTEMPT_TTL_MS;
  }
  return false;
};

const findBlockingAddonAttempt = async (
  collection: Collection<Document>,
  targetBookingId: string,
  serviceKeys: BookingAddonServiceKey[]
): Promise<BlockingAddonAttempt | null> => {
  if (!targetBookingId || serviceKeys.length === 0) return null;
  const sort = { updatedAt: -1, createdAt: -1 } as const;
  const statusFilter = { $in: [...ADDON_ACTIVE_ATTEMPT_STATUSES] };
  const projection = {
    _id: 0,
    provider: 1,
    orderId: 1,
    orderNumber: 1,
    status: 1,
    createdAt: 1,
    updatedAt: 1,
    addon: 1,
  };
  const attempts = (await collection
    .find(
      {
        flow: "booking_addons",
        "addon.targetBookingId": targetBookingId,
        status: statusFilter,
        "addon.serviceKeys": { $in: serviceKeys },
      },
      { projection }
    )
    .sort(sort)
    .limit(DUPLICATE_ATTEMPT_LOOKUP_LIMIT)
    .toArray()) as BlockingAddonAttempt[];

  for (const attempt of attempts) {
    if (isBlockingAddonAttempt(attempt)) return attempt;
  }

  return null;
};

const resolveAddonServiceFlag = (service: BookingAddonServiceKey) => {
  if (service === "transfer") return "transfer" as const;
  if (service === "excursion") return "excursion" as const;
  if (service === "flight") return "flight" as const;
  return "insurance" as const;
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

const initializeIdbankPayment = async (params: {
  amountMinor: number;
  currencyCode: string;
  orderNumber: string;
  description: string;
  language: string;
  returnUrl: string;
  pageView: string;
  locale: string | null;
}) => {
  const config = resolveIdbankConfig();
  if (!config.userName || !config.password || !config.baseUrl) {
    throw new Error("Card payment is not configured. Please contact support.");
  }

  const query = new URLSearchParams();
  query.set("userName", config.userName);
  query.set("password", config.password);
  query.set("orderNumber", params.orderNumber);
  query.set("amount", String(params.amountMinor));
  query.set("currency", params.currencyCode);
  query.set("returnUrl", params.returnUrl);
  if (params.description) query.set("description", params.description);
  if (params.language) query.set("language", params.language);
  if (params.pageView) query.set("pageView", params.pageView);
  query.set("jsonParams", JSON.stringify({ orderNumber: params.orderNumber, locale: params.locale }));

  const response = await fetch(`${config.baseUrl}/register.do`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: query.toString(),
  });

  const body = await extractJsonResponse(response);
  if (!body) {
    throw new Error("Payment gateway response invalid.");
  }

  const errorCode =
    typeof body.errorCode === "number" || typeof body.errorCode === "string"
      ? String(body.errorCode)
      : null;
  const formUrl = typeof body.formUrl === "string" ? body.formUrl.trim() : "";
  const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
  const hasError = errorCode !== null && errorCode !== "0";

  if (!response.ok || hasError || !formUrl || !orderId) {
    const message =
      typeof body.errorMessage === "string" && body.errorMessage.trim().length > 0
        ? body.errorMessage
        : "Failed to initialize card payment.";
    console.error("[Vpos][checkout][idbank] Gateway error", body);
    throw new Error(message);
  }

  return {
    orderId,
    orderNumber: params.orderNumber,
    formUrl,
    gatewayMeta: {
      provider: "idbank",
      baseUrl: config.baseUrl,
      userName: config.userName,
      returnUrl: params.returnUrl,
      pageView: params.pageView,
    },
  } satisfies VposInitResult;
};

const initializeAmeriaPayment = async (params: {
  amountValue: number;
  amountMinor: number;
  currencyCode: string;
  description: string;
  language: string;
  returnUrl: string;
  payload: AoryxBookingPayload;
  locale: string | null;
}) => {
  const config = resolveAmeriaConfig();
  if (!config.baseUrl || !config.clientId || !config.userName || !config.password) {
    throw new Error("Card payment is not configured. Please contact support.");
  }

  const range = resolveAmeriaOrderRange(config.baseUrl);
  const payLanguage = resolveAmeriaLanguage(params.language);
  let lastErrorMessage = "Failed to initialize card payment.";

  for (let attempt = 0; attempt < AMERIA_MAX_INIT_RETRIES; attempt += 1) {
    const orderIdNumeric = buildAmeriaOrderId(params.payload.customerRefNumber ?? null, range, attempt);
    const orderNumber = String(orderIdNumeric);
    const opaque = JSON.stringify({ orderNumber, locale: params.locale, provider: "ameriabank" });

    const initPayload = {
      ClientID: config.clientId,
      Username: config.userName,
      Password: config.password,
      Currency: params.currencyCode,
      Description: params.description,
      OrderID: orderIdNumeric,
      Amount: params.amountValue,
      BackURL: params.returnUrl,
      Opaque: opaque,
      Timeout: config.timeout,
    };

    const response = await fetch(`${config.baseUrl}/api/VPOS/InitPayment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(initPayload),
    });

    const body = (await extractJsonResponse(response)) as AmeriaInitResponse | null;
    if (!body) {
      throw new Error("Payment gateway response invalid.");
    }

    const responseCode =
      typeof body.ResponseCode === "number" || typeof body.ResponseCode === "string"
        ? String(body.ResponseCode).trim()
        : "";
    const responseMessage =
      typeof body.ResponseMessage === "string" && body.ResponseMessage.trim().length > 0
        ? body.ResponseMessage.trim()
        : null;
    const paymentId = typeof body.PaymentID === "string" ? body.PaymentID.trim() : "";
    const isDuplicateOrderError = responseCode === "01" || responseCode === "08204";

    if (response.ok && responseCode === "1" && paymentId) {
      const formUrl = `${config.baseUrl}/Payments/Pay?id=${encodeURIComponent(paymentId)}&lang=${encodeURIComponent(payLanguage)}`;
      return {
        orderId: paymentId,
        orderNumber,
        formUrl,
        gatewayMeta: {
          provider: "ameriabank",
          baseUrl: config.baseUrl,
          clientId: config.clientId,
          userName: config.userName,
          returnUrl: params.returnUrl,
          language: payLanguage,
          originalOrderId: orderIdNumeric,
          amountMinor: params.amountMinor,
        },
      } satisfies VposInitResult;
    }

    lastErrorMessage = responseMessage ?? "Failed to initialize card payment.";
    console.error("[Vpos][checkout][ameriabank] Gateway error", {
      responseCode,
      responseMessage,
      attempt,
      orderIdNumeric,
      paymentId,
      body,
    });

    if (!isDuplicateOrderError) {
      break;
    }
  }

  throw new Error(lastErrorMessage);
};

const tryHandleBookingAddonCheckout = async (params: {
  body: unknown;
  request: NextRequest;
  provider: PaymentProvider;
  locale: string | null;
}): Promise<NextResponse | null> => {
  const addonRequest: BookingAddonCheckoutRequest | null = parseBookingAddonCheckoutRequest(params.body);
  if (!addonRequest) return null;

  const session = await getServerSession(authOptions);
  const userId = session?.user?.id ?? null;
  if (!userId) {
    return NextResponse.json({ error: "Please sign in to continue." }, { status: 401 });
  }

  const db = await getDb();
  const vposCollection = db.collection("vpos_payments");
  const userBookingsCollection = db.collection("user_bookings");
  const userBooking = (await userBookingsCollection.findOne({
    userIdString: userId,
    "payload.customerRefNumber": addonRequest.bookingId,
  })) as UserBookingRecord | null;

  if (!userBooking?.payload) {
    return NextResponse.json({ error: "Booking not found." }, { status: 404 });
  }
  if (!isBookingConfirmed(userBooking.booking ?? null)) {
    return NextResponse.json(
      {
        error: "This booking is not confirmed yet.",
        code: "booking_not_confirmed",
      },
      { status: 409 }
    );
  }
  if (isBookingCanceled(userBooking.booking ?? null)) {
    return NextResponse.json(
      {
        error: "Canceled bookings can not receive additional services.",
        code: "booking_canceled",
      },
      { status: 409 }
    );
  }

  try {
    validateTransferFlightDetailsForBooking(addonRequest.services.transferSelection);
  } catch (validationError) {
    return NextResponse.json(
      {
        error:
          validationError instanceof Error
            ? validationError.message
            : "Transfer flight details are invalid.",
      },
      { status: 400 }
    );
  }

  const existingServiceKeys = new Set(resolveExistingBookingAddonServiceKeys(userBooking.payload));
  const duplicateServices = addonRequest.serviceKeys.filter((service) => existingServiceKeys.has(service));
  if (duplicateServices.length > 0) {
    return NextResponse.json(
      {
        error: "Selected services are already attached to this booking.",
        code: "addon_service_exists",
        services: duplicateServices,
      },
      { status: 409 }
    );
  }

  const serviceFlags = await getServiceFlags().catch(() => DEFAULT_SERVICE_FLAGS);
  const disabledServices = addonRequest.serviceKeys.filter(
    (service) => serviceFlags[resolveAddonServiceFlag(service)] === false
  );
  if (disabledServices.length > 0) {
    return NextResponse.json(
      {
        error: "One or more selected services are currently disabled.",
        code: "service_disabled",
        services: disabledServices,
      },
      { status: 403 }
    );
  }

  const blockingAddonAttempt = await findBlockingAddonAttempt(
    vposCollection,
    userBooking._id.toString(),
    addonRequest.serviceKeys
  );
  if (blockingAddonAttempt) {
    return NextResponse.json(
      {
        error:
          "A payment attempt for the selected add-on services is already active. Please complete it or wait a few minutes.",
        code: "duplicate_payment_attempt",
        existingPayment: {
          provider: resolveString(blockingAddonAttempt.provider) || null,
          status: resolveString(blockingAddonAttempt.status) || null,
          orderId: resolveString(blockingAddonAttempt.orderId) || null,
          orderNumber: resolveString(blockingAddonAttempt.orderNumber) || null,
        },
      },
      { status: 409 }
    );
  }

  let addonAmountAmd: Awaited<ReturnType<typeof calculateBookingAddonAmountAmd>>;
  try {
    addonAmountAmd = await calculateBookingAddonAmountAmd(
      addonRequest.services,
      userBooking.payload.currency ?? "USD"
    );
  } catch (error) {
    console.error("[Vpos][checkout][addons] Failed to calculate add-on amount", error);
    return NextResponse.json(
      { error: "Failed to calculate add-on amount in AMD." },
      { status: 500 }
    );
  }

  const { code: currencyCode, decimals: currencyDecimals } = resolveCurrencyConfig(params.provider);
  if (currencyCode !== "051") {
    return NextResponse.json(
      { error: "Card payment is configured for AMD only." },
      { status: 500 }
    );
  }

  let amountValue = Number(addonAmountAmd.totalAmd.toFixed(currencyDecimals));
  const ameriaBaseUrl = params.provider === "ameriabank" ? resolveAmeriaConfig().baseUrl : "";
  const ameriaOverrideAmount =
    params.provider === "ameriabank" ? resolveAmeriaOverrideAmount(ameriaBaseUrl) : null;
  if (params.provider === "ameriabank" && ameriaOverrideAmount !== null) {
    amountValue = Number(ameriaOverrideAmount.toFixed(currencyDecimals));
  }

  const amountMinor = toMinorUnits(amountValue, currencyDecimals);
  if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
    return NextResponse.json({ error: "Invalid payment amount." }, { status: 400 });
  }

  const orderNumber = buildOrderNumber(`ADDON-${addonRequest.bookingId}`);
  const description = sanitizeDescription(`Add-ons ${addonRequest.bookingId}`);
  const language = normalizeLanguage(
    params.provider === "ameriabank"
      ? process.env.AMERIA_VPOS_LANGUAGE ?? params.locale ?? undefined
      : process.env.VPOS_LANGUAGE ?? params.locale ?? undefined
  );
  const returnUrl = buildReturnUrl(params.request);
  const pageView = resolvePageView(params.request.headers.get("user-agent"));

  let initResult: VposInitResult;
  try {
    initResult =
      params.provider === "ameriabank"
        ? await initializeAmeriaPayment({
            amountValue,
            amountMinor,
            currencyCode,
            description,
            language,
            returnUrl,
            payload: userBooking.payload,
            locale: params.locale,
          })
        : await initializeIdbankPayment({
            amountMinor,
            currencyCode,
            orderNumber,
            description,
            language,
            returnUrl,
            pageView,
            locale: params.locale,
          });
  } catch (gatewayError) {
    const message =
      gatewayError instanceof Error && gatewayError.message.trim().length > 0
        ? gatewayError.message
        : "Failed to initialize card payment.";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const mergedPayload = mergeBookingAddonPayload(userBooking.payload, addonRequest.services).payload;
  const now = new Date();
  await vposCollection.insertOne({
    flow: "booking_addons",
    provider: params.provider,
    orderId: initResult.orderId,
    orderNumber: initResult.orderNumber,
    status: "created",
    amount: {
      value: amountValue,
      minor: amountMinor,
      currency: "AMD",
      currencyCode,
      decimals: currencyDecimals,
      baseValue: addonAmountAmd.totalAmd,
      baseCurrency: "AMD",
      convertedValue: addonAmountAmd.totalAmd,
      breakdownAmd: {
        rooms: 0,
        transfer: addonAmountAmd.breakdownAmd.transfer,
        excursions: addonAmountAmd.breakdownAmd.excursions,
        insurance: addonAmountAmd.breakdownAmd.insurance,
        flights: addonAmountAmd.breakdownAmd.flights,
      },
      discount: null,
    },
    description,
    payload: mergedPayload,
    addon: {
      targetBookingId: userBooking._id.toString(),
      customerRefNumber: addonRequest.bookingId,
      serviceKeys: addonRequest.serviceKeys,
      services: addonRequest.services,
      existingServiceKeys: [...existingServiceKeys],
    },
    userId,
    userEmail: session?.user?.email ?? null,
    userName: session?.user?.name ?? null,
    locale: params.locale,
    gateway: initResult.gatewayMeta,
    createdAt: now,
    updatedAt: now,
  });

  return NextResponse.json({
    formUrl: initResult.formUrl,
    orderId: initResult.orderId,
    orderNumber: initResult.orderNumber,
  });
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const locale =
      typeof (body as { locale?: unknown }).locale === "string"
        ? (body as { locale?: string }).locale?.trim() ?? null
        : null;
    const provider = parsePaymentProvider((body as { paymentProvider?: unknown }).paymentProvider);
    const paymentMethodFlags = await getPaymentMethodFlags();
    const isMethodEnabled =
      provider === "ameriabank" ? paymentMethodFlags.ameria_card : paymentMethodFlags.idbank_card;
    if (isMethodEnabled === false) {
      const providerLabel = provider === "ameriabank" ? "Ameriabank" : "IDBank";
      return NextResponse.json(
        {
          error: `${providerLabel} card payments are currently disabled.`,
          code: "payment_method_disabled",
        },
        { status: 403 }
      );
    }

    const addonResponse = await tryHandleBookingAddonCheckout({
      body,
      request,
      provider,
      locale,
    });
    if (addonResponse) {
      return addonResponse;
    }

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
        validationError instanceof Error
          ? validationError.message
          : "Rate selection changed. Please prebook again.";
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

    const db = await getDb();
    const vposCollection = db.collection("vpos_payments");
    const bookingRateKeyHashes = resolveBookingRateKeyHashes(payload, prebookState);
    const bookingFingerprint = buildBookingFingerprint(payload, bookingRateKeyHashes);
    const blockingAttempt = await findBlockingAttempt(vposCollection, bookingFingerprint, payload);
    if (blockingAttempt) {
      return NextResponse.json(
        {
          error: duplicateAttemptMessage(blockingAttempt),
          code: "duplicate_payment_attempt",
          existingPayment: {
            provider: resolveString(blockingAttempt.provider) || null,
            status: resolveString(blockingAttempt.status) || null,
            orderId: resolveString(blockingAttempt.orderId) || null,
            orderNumber: resolveString(blockingAttempt.orderNumber) || null,
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

    let totalAmd = 0;
    let amountBreakdownAmd = {
      rooms: 0,
      transfer: 0,
      excursions: 0,
      insurance: 0,
      flights: 0,
    };
    try {
      const rates = await getAmdRates();
      const rateCache = new Map<string, number>();
      const normalizeCurrency = (value: string | null | undefined) => {
        const normalized = (value ?? "").trim().toUpperCase();
        return normalized.length > 0 ? normalized : "USD";
      };
      const resolveRate = async (currency: string | null | undefined) => {
        const normalized = normalizeCurrency(currency ?? payload.currency ?? undefined);
        if (normalized === "USD") return rates.USD;
        if (normalized === "EUR") return rates.EUR;
        if (normalized === "AMD") return 1;
        const cached = rateCache.get(normalized);
        if (cached != null) return cached;
        const extraRate = await getAmdRateForCurrency(normalized);
        if (extraRate === null) {
          throw new Error(`Missing exchange rate for ${normalized}`);
        }
        rateCache.set(normalized, extraRate);
        return extraRate;
      };
      const convertAmount = async (amount: number, currency: string | null | undefined) => {
        if (!Number.isFinite(amount) || amount <= 0) return 0;
        const rate = await resolveRate(currency);
        return amount * rate;
      };
      const transferCurrency = payload.transferSelection?.pricing?.currency ?? payload.currency;
      const excursionsCurrency = payload.excursions?.selections?.[0]?.currency ?? payload.currency;
      const insuranceCurrency = payload.insurance?.currency ?? payload.currency;
      const flightsCurrency = payload.airTickets?.currency ?? payload.currency;
      const [roomsAmd, transferAmd, excursionsAmd, insuranceAmd, flightsAmd] = await Promise.all([
        convertAmount(roomsTotalWithMarkup, payload.currency),
        convertAmount(transferTotal, transferCurrency),
        convertAmount(excursionsTotal, excursionsCurrency),
        convertAmount(insuranceTotal, insuranceCurrency),
        convertAmount(flightsTotal, flightsCurrency),
      ]);
      amountBreakdownAmd = {
        rooms: roomsAmd,
        transfer: transferAmd,
        excursions: excursionsAmd,
        insurance: insuranceAmd,
        flights: flightsAmd,
      };
      totalAmd = roomsAmd + transferAmd + excursionsAmd + insuranceAmd + flightsAmd;
    } catch (error) {
      console.error("[Vpos][checkout] Failed to convert amount", error);
      return NextResponse.json(
        { error: "Failed to calculate AMD total. Please try again." },
        { status: 500 }
      );
    }

    const couponAmountBreakdownAmd =
      couponDetails && totalAmd > 0
        ? (() => {
            const amounts = applyCouponPercentDiscount(totalAmd, couponDetails.discountPercent);
            return {
              code: couponDetails.code,
              discountPercent: couponDetails.discountPercent,
              discountAmount: amounts.discountAmount,
              discountedAmount: amounts.discountedAmount,
            };
          })()
        : null;

    if (couponAmountBreakdownAmd) {
      totalAmd = couponAmountBreakdownAmd.discountedAmount;
    }

    const { code: currencyCode, decimals: currencyDecimals } = resolveCurrencyConfig(provider);
    if (currencyCode !== "051") {
      return NextResponse.json(
        { error: "Card payment is configured for AMD only." },
        { status: 500 }
      );
    }

    let amountValue = Number((totalAmd || 0).toFixed(currencyDecimals));
    const ameriaBaseUrl = provider === "ameriabank" ? resolveAmeriaConfig().baseUrl : "";
    const ameriaOverrideAmount = provider === "ameriabank" ? resolveAmeriaOverrideAmount(ameriaBaseUrl) : null;
    if (provider === "ameriabank" && ameriaOverrideAmount !== null) {
      amountValue = Number(ameriaOverrideAmount.toFixed(currencyDecimals));
    }

    const amountMinor = toMinorUnits(amountValue, currencyDecimals);
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
      return NextResponse.json({ error: "Invalid payment amount." }, { status: 400 });
    }

    const orderNumber = buildOrderNumber(payload.customerRefNumber ?? null);
    const description = sanitizeDescription(`Booking ${payload.hotelCode}`);
    const language = normalizeLanguage(
      provider === "ameriabank"
        ? process.env.AMERIA_VPOS_LANGUAGE ?? locale ?? undefined
        : process.env.VPOS_LANGUAGE ?? locale ?? undefined
    );
    const returnUrl = buildReturnUrl(request);
    const pageView = resolvePageView(request.headers.get("user-agent"));

    let initResult: VposInitResult;
    try {
      initResult =
        provider === "ameriabank"
          ? await initializeAmeriaPayment({
              amountValue,
              amountMinor,
              currencyCode,
              description,
              language,
              returnUrl,
              payload,
              locale,
            })
          : await initializeIdbankPayment({
              amountMinor,
              currencyCode,
              orderNumber,
              description,
              language,
              returnUrl,
              pageView,
              locale,
            });
    } catch (gatewayError) {
      const message =
        gatewayError instanceof Error && gatewayError.message.trim().length > 0
          ? gatewayError.message
          : "Failed to initialize card payment.";
      return NextResponse.json({ error: message }, { status: 502 });
    }

    const session = await getServerSession(authOptions);
    const userId = session?.user?.id ?? null;
    const userEmail = session?.user?.email ?? null;
    const userNameValue = session?.user?.name ?? null;

    const now = new Date();
    await vposCollection.insertOne({
      provider,
      orderId: initResult.orderId,
      orderNumber: initResult.orderNumber,
      status: "created",
      bookingFingerprint,
      bookingKey: {
        sessionId: payload.sessionId,
        hotelCode: payload.hotelCode,
        groupCode: payload.groupCode,
        rateKeyHashes: bookingRateKeyHashes,
      },
      amount: {
        value: amountValue,
        minor: amountMinor,
        currency: "AMD",
        currencyCode,
        decimals: currencyDecimals,
        baseValue: baseAmount,
        baseCurrency: payload.currency,
        convertedValue: totalAmd,
        breakdownAmd: amountBreakdownAmd,
        discount: couponAmountBreakdownAmd,
      },
      description,
      payload,
      prebookState,
      coupon: couponAmountBreakdownAmd,
      userId,
      userEmail,
      userName: userNameValue,
      locale,
      gateway: initResult.gatewayMeta,
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json({
      formUrl: initResult.formUrl,
      orderId: initResult.orderId,
      orderNumber: initResult.orderNumber,
    });
  } catch (error) {
    console.error("[Vpos][checkout] Failed to initialize payment", error);
    return NextResponse.json({ error: "Failed to initialize payment" }, { status: 500 });
  }
}
