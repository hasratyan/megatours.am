import { NextRequest, NextResponse } from "next/server";
import { ObjectId, type Collection, type Document } from "mongodb";
import { getDb } from "@/lib/db";
import { AoryxClientError, book, bookingDetails } from "@/lib/aoryx-client";
import { createEfesPoliciesFromBooking } from "@/lib/efes-client";
import { recordUserBooking, type AppliedBookingCoupon } from "@/lib/user-data";
import { sendBookingConfirmationEmail } from "@/lib/email";
import { incrementCouponSuccessfulOrders } from "@/lib/coupons";
import { defaultLocale, Locale, locales } from "@/lib/i18n";
import { resolveBookingStatusKey } from "@/lib/booking-status";
import {
  mergeBookingAddonPayload,
  parseBookingAddonServices,
  resolveBookingAddonServiceKeys,
} from "@/lib/booking-addons";
import type { AoryxBookingPayload, AoryxBookingResult } from "@/types/aoryx";

export const runtime = "nodejs";

type PaymentProvider = "idbank" | "ameriabank";

type VposPaymentRecord = {
  flow?: string | null;
  provider?: PaymentProvider | string;
  orderId?: string;
  orderNumber?: string;
  status?: string;
  amount?: {
    value?: number;
    minor?: number;
    currency?: string;
    currencyCode?: string;
    decimals?: number;
  };
  payload?: AoryxBookingPayload;
  coupon?: {
    code?: string | null;
    discountPercent?: number | null;
    discountAmount?: number | null;
    discountedAmount?: number | null;
  } | null;
  couponOrderCounted?: boolean;
  userId?: string | null;
  userEmail?: string | null;
  userName?: string | null;
  locale?: string | null;
  bookingResult?: AoryxBookingResult | Record<string, unknown> | null;
  addon?: {
    targetBookingId?: string | null;
    customerRefNumber?: string | null;
    serviceKeys?: unknown;
    services?: unknown;
  } | null;
  updatedAt?: Date | string | number | null;
  paidAt?: Date | string | number | null;
};

type IdbankStatusResponse = {
  amount?: number | string;
  currency?: number | string;
  orderStatus?: number | string;
  orderStatusName?: string;
  actionCode?: number | string;
  actionCodeDescription?: string;
  errorCode?: number | string;
  errorMessage?: string;
  paymentState?: number | string;
  PaymentState?: number | string;
  paymentAmountInfo?: Record<string, unknown>;
  PaymentAmountInfo?: Record<string, unknown>;
};

type AmeriaStatusResponse = {
  Amount?: number | string;
  Currency?: number | string;
  OrderStatus?: number | string;
  ActionCode?: number | string;
  ActionCodeDescription?: string;
  ResponseCode?: number | string;
  ResponseMessage?: string;
  PaymentState?: string;
};

type GatewayStatus = {
  responseAmountMinor: number | null;
  responseCurrency: string;
  orderStatus: number | null;
  actionCode: number | null;
  actionCodeDescription: string | null;
  errorCode: number | null;
  errorMessage: string | null;
  gatewaySuccess: boolean;
  raw: Record<string, unknown>;
};

const IDBANK_DEFAULT_BASE_URL = "https://ipaytest.arca.am:8445/payment/rest";
const AMERIA_DEFAULT_BASE_URL = "https://servicestest.ameriabank.am/VPOS";
const DEFAULT_LANGUAGE = "en";
const BOOKING_STATUS_POLL_ATTEMPTS = 20;
const BOOKING_STATUS_POLL_INTERVAL_MS = 1000;
const STALE_BOOKING_IN_PROGRESS_MS = 90 * 1000;
const VPOS_PUBLIC_ORIGIN = "https://megatours.am";

const normalizeBaseUrl = (value: string) => value.trim().replace(/\/+$/, "");

const resolveString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const summarizeEfesInsurance = (payload: AoryxBookingPayload | undefined) => {
  const insurance = payload?.insurance;
  return {
    hasInsurance: Boolean(insurance),
    provider: insurance?.provider ?? null,
    travelersCount: Array.isArray(insurance?.travelers) ? insurance.travelers.length : 0,
    startDate: insurance?.startDate ?? payload?.checkInDate ?? null,
    endDate: insurance?.endDate ?? payload?.checkOutDate ?? null,
    territoryCode: insurance?.territoryCode ?? null,
    riskAmount: insurance?.riskAmount ?? null,
    riskCurrency: insurance?.riskCurrency ?? null,
  };
};

const isBookingResultConfirmed = (result: AoryxBookingResult | null | undefined) =>
  resolveBookingStatusKey(result?.status) === "confirmed" ||
  Boolean(
    result?.hotelConfirmationNumber ||
    result?.supplierConfirmationNumber ||
    result?.adsConfirmationNumber
  );

const shouldAttemptBookReconciliation = (error: unknown) => {
  if (error instanceof AoryxClientError) {
    const endpoint = resolveString(error.endpoint).toLowerCase();
    const isBookEndpoint = endpoint === "book";
    if (!isBookEndpoint) return false;
    if (typeof error.statusCode !== "number") return true;
    return error.statusCode >= 500;
  }
  if (error instanceof Error) {
    const normalizedMessage = error.message.toLowerCase();
    return (
      normalizedMessage.includes("aborted") ||
      normalizedMessage.includes("timeout") ||
      normalizedMessage.includes("timed out")
    );
  }
  return false;
};

const bookWithRecovery = async (
  payload: AoryxBookingPayload,
  context: { orderId: string; provider: PaymentProvider; orderNumber: string | null }
): Promise<AoryxBookingResult> => {
  try {
    return await book(payload);
  } catch (error) {
    if (!shouldAttemptBookReconciliation(error)) {
      throw error;
    }

    console.warn("[Vpos][result] Aoryx book failed, attempting BookingDetails recovery", {
      orderId: context.orderId,
      orderNumber: context.orderNumber,
      provider: context.provider,
      sessionId: payload.sessionId,
      message: error instanceof Error ? error.message : "Unknown error",
    });

    try {
      const recovered = await bookingDetails(payload.sessionId);
      if (isBookingResultConfirmed(recovered)) {
        console.info("[Vpos][result] BookingDetails recovery confirmed booking", {
          orderId: context.orderId,
          orderNumber: context.orderNumber,
          provider: context.provider,
          sessionId: payload.sessionId,
          status: recovered.status,
          hotelConfirmationNumber: recovered.hotelConfirmationNumber,
          supplierConfirmationNumber: recovered.supplierConfirmationNumber,
          adsConfirmationNumber: recovered.adsConfirmationNumber,
        });
        return recovered;
      }
    } catch (recoveryError) {
      console.error("[Vpos][result] BookingDetails recovery failed", {
        orderId: context.orderId,
        orderNumber: context.orderNumber,
        provider: context.provider,
        sessionId: payload.sessionId,
        message: recoveryError instanceof Error ? recoveryError.message : "Unknown error",
      });
    }

    throw error;
  }
};

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

const normalizeLanguage = (value: string | undefined) => {
  const normalized = (value ?? DEFAULT_LANGUAGE).trim().toLowerCase();
  if (normalized === "hy" || normalized === "ru" || normalized === "en") return normalized;
  return DEFAULT_LANGUAGE;
};

const resolveLocale = (value: string | null | undefined) =>
  locales.includes(value as Locale) ? (value as Locale) : defaultLocale;

const resolveProvider = (value: unknown): PaymentProvider => {
  const normalized = resolveString(value).toLowerCase();
  if (normalized === "ameriabank" || normalized === "ameria") return "ameriabank";
  return "idbank";
};

const normalizeCurrencyCode = (value: unknown) => {
  if (value == null) return "";
  const raw = typeof value === "number" ? String(Math.trunc(value)) : String(value);
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const upper = trimmed.toUpperCase();
  if (upper === "AMD") return "051";
  if (upper === "USD") return "840";
  if (upper === "EUR") return "978";
  if (upper === "RUB") return "643";
  if (/^\d+$/.test(trimmed)) return trimmed.padStart(3, "0");
  return trimmed;
};

const toNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readField = (record: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    if (record[key] != null) {
      return record[key];
    }
  }
  return undefined;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const hasBookingResult = (record: VposPaymentRecord | null) => record?.bookingResult != null;

const resolveCouponCode = (
  record: Pick<VposPaymentRecord, "coupon">
): string | null => {
  const code = typeof record.coupon?.code === "string" ? record.coupon.code.trim().toUpperCase() : "";
  return code.length > 0 ? code : null;
};

const resolveAppliedCoupon = (
  record: Pick<VposPaymentRecord, "coupon">
): AppliedBookingCoupon | null => {
  const code = resolveCouponCode(record);
  const discountPercent =
    typeof record.coupon?.discountPercent === "number" && Number.isFinite(record.coupon.discountPercent)
      ? Math.min(100, Math.max(0, record.coupon.discountPercent))
      : null;
  if (!code || discountPercent === null || discountPercent <= 0) return null;
  return {
    code,
    discountPercent,
    discountAmount:
      typeof record.coupon?.discountAmount === "number" && Number.isFinite(record.coupon.discountAmount)
        ? record.coupon.discountAmount
        : null,
    discountedAmount:
      typeof record.coupon?.discountedAmount === "number" &&
      Number.isFinite(record.coupon.discountedAmount)
        ? record.coupon.discountedAmount
        : null,
  };
};

const isStaleInProgressRecord = (record: VposPaymentRecord | null) => {
  if (record?.status !== "booking_in_progress") return false;
  const lastUpdatedAt = toDate(record.updatedAt) ?? toDate(record.paidAt);
  if (!lastUpdatedAt) return false;
  return Date.now() - lastUpdatedAt.getTime() >= STALE_BOOKING_IN_PROGRESS_MS;
};

const unwrapFindOneAndUpdateResult = <T,>(
  result: unknown
): T | null => {
  if (!result || typeof result !== "object") return null;
  if ("value" in (result as Record<string, unknown>)) {
    return ((result as { value?: unknown }).value ?? null) as T | null;
  }
  return result as T;
};

const buildRedirect = (
  publicOrigin: string,
  locale: Locale,
  path: "/payment/success" | "/payment/fail",
  params: Record<string, string | undefined>
) => {
  const url = new URL(`/${locale}${path}`, publicOrigin);
  Object.entries(params).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });
  return NextResponse.redirect(url);
};

const extractJsonResponse = async (response: Response): Promise<Record<string, unknown>> => {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch (error) {
    const text = await response.text().catch(() => "");
    console.error("[Vpos][result] Invalid JSON response", text, error);
    throw error;
  }
};

const resolveIdbankPaidState = (payload: Record<string, unknown>) => {
  const paymentAmountInfo = isRecord(readField(payload, ["paymentAmountInfo", "PaymentAmountInfo"]))
    ? (readField(payload, ["paymentAmountInfo", "PaymentAmountInfo"]) as Record<string, unknown>)
    : null;
  const orderStatus = toNumber(payload.orderStatus);
  const orderStatusName = resolveString(payload.orderStatusName).toLowerCase();
  const paymentState = resolveString(
    readField({ ...payload, ...(paymentAmountInfo ?? {}) }, ["paymentState", "PaymentState"])
  ).toLowerCase();
  const approvedAmount = toNumber(readField(paymentAmountInfo ?? {}, ["approvedAmount", "ApprovedAmount"]));
  const depositedAmount = toNumber(readField(paymentAmountInfo ?? {}, ["depositedAmount", "DepositedAmount"]));
  const normalizedErrorCode = toNumber(payload.errorCode) ?? 0;

  const hasPaidOrderStatus = orderStatus === 1 || orderStatus === 2;
  const hasPaidOrderStatusName =
    orderStatusName === "payment_approved" || orderStatusName === "payment_deposited";
  const hasPaidPaymentState =
    paymentState === "1" ||
    paymentState === "2" ||
    paymentState === "payment_approved" ||
    paymentState === "payment_deposited" ||
    paymentState === "approved" ||
    paymentState === "deposited";
  const hasCapturedAmount =
    (typeof depositedAmount === "number" && depositedAmount > 0) ||
    (typeof approvedAmount === "number" && approvedAmount > 0);

  return {
    responseAmountMinor: depositedAmount ?? approvedAmount ?? toNumber(payload.amount),
    responseCurrency: normalizeCurrencyCode(payload.currency),
    gatewaySuccess:
      normalizedErrorCode === 0 &&
      (hasPaidOrderStatus || hasPaidOrderStatusName || hasPaidPaymentState || hasCapturedAmount),
  };
};

const fetchIdbankStatus = async (
  orderId: string,
  language: string
): Promise<GatewayStatus> => {
  const baseUrl = normalizeBaseUrl(resolveString(process.env.VPOS_BASE_URL) || IDBANK_DEFAULT_BASE_URL);
  const userName = resolveString(process.env.VPOS_USER);
  const password = resolveString(process.env.VPOS_PASSWORD);
  if (!baseUrl || !userName || !password) {
    throw new Error("Missing IDBank VPOS credentials");
  }

  const params = new URLSearchParams();
  params.set("userName", userName);
  params.set("password", password);
  params.set("orderId", orderId);
  if (language) params.set("language", language);

  const response = await fetch(`${baseUrl}/getOrderStatusExtended.do`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const payload = (await extractJsonResponse(response)) as IdbankStatusResponse & Record<string, unknown>;
  if (!response.ok) {
    throw new Error(payload?.errorMessage || "Payment status lookup failed.");
  }

  const orderStatus = toNumber(payload.orderStatus);
  const actionCode = toNumber(payload.actionCode);
  const errorCode = toNumber(payload.errorCode);
  const paidState = resolveIdbankPaidState(payload);
  const actionCodeDescription =
    typeof payload.actionCodeDescription === "string" ? payload.actionCodeDescription : null;
  const errorMessage = typeof payload.errorMessage === "string" ? payload.errorMessage : null;

  return {
    responseAmountMinor: paidState.responseAmountMinor,
    responseCurrency: paidState.responseCurrency,
    orderStatus,
    actionCode,
    actionCodeDescription,
    errorCode,
    errorMessage,
    gatewaySuccess: paidState.gatewaySuccess,
    raw: payload,
  };
};

const fetchAmeriaStatus = async (
  paymentId: string,
  language: string,
  expectedDecimals: number
): Promise<GatewayStatus> => {
  const baseUrl = normalizeBaseUrl(
    resolveString(process.env.AMERIA_VPOS_BASE_URL) || AMERIA_DEFAULT_BASE_URL
  );
  const userName = resolveString(process.env.AMERIA_VPOS_USERNAME);
  const password = resolveString(process.env.AMERIA_VPOS_PASSWORD);
  if (!baseUrl || !userName || !password) {
    throw new Error("Missing Ameriabank VPOS credentials");
  }

  const requestBody = {
    PaymentID: paymentId,
    Username: userName,
    Password: password,
  };

  const response = await fetch(`${baseUrl}/api/VPOS/GetPaymentDetails?lang=${encodeURIComponent(language)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });

  const payload = (await extractJsonResponse(response)) as AmeriaStatusResponse & Record<string, unknown>;
  if (!response.ok) {
    throw new Error(payload?.ResponseMessage || "Payment status lookup failed.");
  }

  const orderStatus = toNumber(payload.OrderStatus);
  const actionCode = toNumber(payload.ActionCode);
  const responseCodeRaw =
    typeof payload.ResponseCode === "number" || typeof payload.ResponseCode === "string"
      ? String(payload.ResponseCode).trim()
      : "";
  const errorCode = toNumber(payload.ResponseCode);
  const responseAmount = toNumber(payload.Amount);
  const responseAmountMinor =
    responseAmount !== null ? Math.round(responseAmount * Math.pow(10, expectedDecimals)) : null;
  const responseCurrency = normalizeCurrencyCode(payload.Currency);
  const actionCodeDescription =
    typeof payload.ActionCodeDescription === "string" ? payload.ActionCodeDescription : null;
  const errorMessage =
    typeof payload.ResponseMessage === "string"
      ? payload.ResponseMessage
      : typeof payload.ActionCodeDescription === "string"
        ? payload.ActionCodeDescription
        : null;

  const paymentState = resolveString(payload.PaymentState).toLowerCase();
  const isSuccessfulCode = responseCodeRaw === "00" || responseCodeRaw === "0";
  const isPaidStatus = orderStatus === 2 || paymentState === "payment_deposited";
  const gatewaySuccess = isSuccessfulCode && isPaidStatus;

  return {
    responseAmountMinor,
    responseCurrency,
    orderStatus,
    actionCode,
    actionCodeDescription,
    errorCode,
    errorMessage,
    gatewaySuccess,
    raw: payload,
  };
};

const getGatewayStatus = async (
  provider: PaymentProvider,
  orderId: string,
  language: string,
  expectedDecimals: number
) => {
  if (provider === "ameriabank") {
    return fetchAmeriaStatus(orderId, language, expectedDecimals);
  }
  return fetchIdbankStatus(orderId, language);
};

const appendCallbackParams = (target: URLSearchParams, payload: unknown) => {
  if (!isRecord(payload)) return;
  Object.entries(payload).forEach(([key, value]) => {
    if (value == null) return;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      target.set(key, String(value));
    }
  });
};

const collectCallbackParams = async (request: NextRequest) => {
  const params = new URLSearchParams(request.nextUrl.searchParams);
  if (request.method === "GET" || request.method === "HEAD") {
    return params;
  }

  const contentType = resolveString(request.headers.get("content-type")).toLowerCase();

  try {
    if (contentType.includes("application/json")) {
      appendCallbackParams(params, await request.json());
      return params;
    }

    const formData = await request.formData();
    formData.forEach((value, key) => {
      if (typeof value === "string") {
        params.set(key, value);
      }
    });
  } catch (error) {
    console.warn("[Vpos][result] Failed to parse callback payload", {
      method: request.method,
      contentType,
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }

  return params;
};

const getFirstParam = (params: URLSearchParams, names: string[]) => {
  for (const name of names) {
    const value = params.get(name);
    if (value) return value;
  }
  return null;
};

const buildDiagnosticEvent = (
  stage: string,
  level: "info" | "warn" | "error",
  reason: string,
  details: Record<string, unknown> = {}
) => ({
  at: new Date(),
  stage,
  level,
  reason,
  details,
});

const handleResultCallback = async (request: NextRequest) => {
  const publicOrigin = resolvePublicOrigin(request);
  const redirect = (
    locale: Locale,
    path: "/payment/success" | "/payment/fail",
    params: Record<string, string | undefined>
  ) => buildRedirect(publicOrigin, locale, path, params);

  const searchParams = await collectCallbackParams(request);
  const paymentIdParam = getFirstParam(searchParams, ["paymentID", "paymentId", "PaymentID"]);
  const orderIdParam =
    getFirstParam(searchParams, ["orderId", "OrderId", "mdOrder", "MDORDER"]) ||
    paymentIdParam;
  const orderNumberParam = getFirstParam(searchParams, [
    "orderNumber",
    "OrderNumber",
    "merchantOrderNumber",
    "orderID",
    "OrderID",
  ]);
  const callbackDetails = {
    method: request.method,
    path: request.nextUrl.pathname,
    contentType: resolveString(request.headers.get("content-type")) || null,
    clientIp: resolveString(request.headers.get("x-forwarded-for")).split(",")[0]?.trim() || null,
    userAgent: resolveString(request.headers.get("user-agent")) || null,
    paramKeys: Array.from(new Set(Array.from(searchParams.keys()))).sort(),
    paymentIdParam,
    orderIdParam,
    orderNumberParam,
    mdOrderParam: getFirstParam(searchParams, ["mdOrder", "MDORDER"]),
    callbackErrorCode: getFirstParam(searchParams, ["errorCode", "ErrorCode"]),
    callbackActionCode: getFirstParam(searchParams, ["actionCode", "ActionCode"]),
  };
  let paymentCollection: Collection<Document> | null = null;
  let diagnosticOrderId: string | null = orderIdParam ?? paymentIdParam ?? null;
  const appendDiagnosticEvent = async (
    stage: string,
    level: "info" | "warn" | "error",
    reason: string,
    details: Record<string, unknown> = {},
    extraSet: Record<string, unknown> = {}
  ) => {
    if (!paymentCollection || !diagnosticOrderId) return;
    const event = buildDiagnosticEvent(stage, level, reason, details);
    try {
      await paymentCollection.updateOne(
        { orderId: diagnosticOrderId },
        {
          $push: {
            "diagnostics.events": {
              $each: [event],
              $slice: -50,
            },
          },
          $set: {
            "diagnostics.lastEvent": event,
            "diagnostics.updatedAt": new Date(),
            ...extraSet,
          },
        } as Document
      );
    } catch (error) {
      console.error("[Vpos][result] Failed to persist diagnostic event", {
        orderId: diagnosticOrderId,
        stage,
        reason,
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };
  const logRedirect = async (
    level: "info" | "warn" | "error",
    side: "callback" | "database" | "gateway" | "integration" | "application",
    locale: Locale,
    path: "/payment/success" | "/payment/fail",
    params: Record<string, string | undefined>,
    reason: string,
    details: Record<string, unknown> = {}
  ) => {
    const payload = {
      side,
      reason,
      redirectPath: path,
      locale,
      redirectOrderId: params.orderId ?? null,
      redirectOrderNumber: params.orderNumber ?? null,
      ...callbackDetails,
      ...details,
    };
    if (level === "error") {
      console.error("[Vpos][result] Redirect decision", payload);
    } else if (level === "warn") {
      console.warn("[Vpos][result] Redirect decision", payload);
    } else {
      console.info("[Vpos][result] Redirect decision", payload);
    }
    await appendDiagnosticEvent(
      "redirect",
      level,
      reason,
      {
        side,
        redirectPath: path,
        locale,
        redirectOrderId: params.orderId ?? null,
        redirectOrderNumber: params.orderNumber ?? null,
        ...details,
      },
      {
        "diagnostics.lastRedirectDecision": {
          at: new Date(),
          level,
          side,
          reason,
          redirectPath: path,
          locale,
          redirectOrderId: params.orderId ?? null,
          redirectOrderNumber: params.orderNumber ?? null,
          ...details,
        },
      }
    );
    return redirect(locale, path, params);
  };

  console.info("[Vpos][result] Callback received", callbackDetails);

  if (!orderIdParam && !orderNumberParam) {
    return logRedirect("warn", "callback", defaultLocale, "/payment/fail", {}, "missing_callback_identifiers");
  }

  let db: Awaited<ReturnType<typeof getDb>>;
  try {
    db = await getDb();
  } catch (error) {
    console.error("[Vpos][result] Failed to connect to database", error);
    return logRedirect("error", "database", defaultLocale, "/payment/fail", {}, "database_connection_failed");
  }

  const collection = db.collection("vpos_payments");
  paymentCollection = collection;
  let record = (orderIdParam
    ? await collection.findOne({ orderId: orderIdParam })
    : null) as VposPaymentRecord | null;
  if (!record && paymentIdParam && paymentIdParam !== orderIdParam) {
    record = (await collection.findOne({ orderId: paymentIdParam })) as VposPaymentRecord | null;
  }
  if (!record && orderNumberParam) {
    record = (await collection.findOne({ orderNumber: orderNumberParam })) as VposPaymentRecord | null;
  }

  if (!record) {
    return logRedirect("warn", "callback", defaultLocale, "/payment/fail", {}, "payment_record_not_found");
  }

  const locale = resolveLocale(record.locale);
  const provider = resolveProvider(record.provider);
  const orderId = record.orderId || orderIdParam || paymentIdParam || "";
  const orderNumber = record.orderNumber || orderNumberParam || "";
  diagnosticOrderId = orderId || diagnosticOrderId;

  console.info("[Vpos][result] Payment record matched", {
    orderId,
    orderNumber,
    provider,
    recordStatus: record.status ?? null,
    flow: record.flow ?? null,
    locale,
  });
  await appendDiagnosticEvent(
    "callback",
    "info",
    "payment_record_matched",
    {
      provider,
      orderId,
      orderNumber,
      recordStatus: record.status ?? null,
      flow: record.flow ?? null,
    },
    {
      "diagnostics.lastCallback": {
        at: new Date(),
        ...callbackDetails,
      },
    }
  );

  if (!orderId) {
    return logRedirect(
      "warn",
      "integration",
      locale,
      "/payment/fail",
      { orderNumber },
      "resolved_payment_record_missing_order_id",
      { provider, recordStatus: record.status ?? null }
    );
  }

  if (record.status === "booking_complete") {
    const couponCode = resolveCouponCode(record);
    if (couponCode && record.couponOrderCounted !== true) {
      try {
        const markResult = await collection.updateOne(
          { orderId, couponOrderCounted: { $ne: true } },
          {
            $set: {
              couponOrderCounted: true,
              couponOrderCountedAt: new Date(),
              updatedAt: new Date(),
            },
          }
        );
        if (markResult.modifiedCount > 0) {
          try {
            await incrementCouponSuccessfulOrders(couponCode);
          } catch (error) {
            await collection.updateOne(
              { orderId },
              {
                $set: {
                  couponOrderCounted: false,
                  couponOrderCountError:
                    error instanceof Error
                      ? error.message
                      : "Failed to update coupon order stats",
                  updatedAt: new Date(),
                },
              }
            );
            throw error;
          }
        }
      } catch (error) {
        console.error("[Vpos][result] Failed to update coupon order stats", error);
      }
    }
    return logRedirect(
      "info",
      "application",
      locale,
      "/payment/success",
      { orderId, orderNumber },
      "payment_already_completed",
      { provider, recordStatus: record.status ?? null }
    );
  }
  if (record.status === "booking_failed") {
    return logRedirect(
      "warn",
      "application",
      locale,
      "/payment/fail",
      { orderId, orderNumber },
      "payment_record_already_failed",
      { provider, recordStatus: record.status ?? null }
    );
  }

  let statusResponse: GatewayStatus;
  try {
    const language = normalizeLanguage(
      provider === "ameriabank"
        ? process.env.AMERIA_VPOS_LANGUAGE ?? record.locale ?? undefined
        : process.env.VPOS_LANGUAGE ?? record.locale ?? undefined
    );
    const decimals =
      typeof record.amount?.decimals === "number" && Number.isFinite(record.amount.decimals)
        ? Math.max(0, Math.trunc(record.amount.decimals))
        : 2;
    statusResponse = await getGatewayStatus(provider, orderId, language, decimals);
  } catch (error) {
    console.error("[Vpos][result] Failed to query gateway status", error);
    return logRedirect(
      "error",
      "gateway",
      locale,
      "/payment/fail",
      { orderId, orderNumber },
      "gateway_status_lookup_failed",
      { provider, message: error instanceof Error ? error.message : "Unknown error" }
    );
  }

  const expectedAmountMinor =
    typeof record.amount?.minor === "number" && Number.isFinite(record.amount.minor)
      ? Math.round(record.amount.minor)
      : null;
  const expectedCurrency = normalizeCurrencyCode(record.amount?.currencyCode ?? "");
  const amountMatches =
    expectedAmountMinor != null &&
    statusResponse.responseAmountMinor != null &&
    expectedAmountMinor === statusResponse.responseAmountMinor;
  const currencyMatches =
    expectedCurrency.length > 0 &&
    statusResponse.responseCurrency.length > 0 &&
    expectedCurrency === statusResponse.responseCurrency;

  const now = new Date();
  const paymentMismatch = !amountMatches || !currencyMatches;
  const paymentSuccess = statusResponse.gatewaySuccess && !paymentMismatch;
  const canUpdateStatus = !["booking_in_progress", "booking_complete", "booking_failed"].includes(
    record.status ?? ""
  );

  console.info("[Vpos][result] Gateway status evaluated", {
    provider,
    orderId,
    orderNumber,
    gatewaySuccess: statusResponse.gatewaySuccess,
    paymentSuccess,
    paymentMismatch,
    expectedAmountMinor,
    actualAmountMinor: statusResponse.responseAmountMinor,
    expectedCurrency,
    actualCurrency: statusResponse.responseCurrency,
    orderStatus: statusResponse.orderStatus,
    actionCode: statusResponse.actionCode,
    actionCodeDescription: statusResponse.actionCodeDescription,
    errorCode: statusResponse.errorCode,
    errorMessage: statusResponse.errorMessage,
    recordStatus: record.status ?? null,
  });
  await appendDiagnosticEvent(
    "gateway",
    paymentSuccess ? "info" : paymentMismatch ? "warn" : "error",
    paymentMismatch ? "gateway_status_mismatch" : paymentSuccess ? "gateway_status_confirmed" : "gateway_status_failed",
    {
      provider,
      orderId,
      orderNumber,
      gatewaySuccess: statusResponse.gatewaySuccess,
      paymentSuccess,
      paymentMismatch,
      expectedAmountMinor,
      actualAmountMinor: statusResponse.responseAmountMinor,
      expectedCurrency,
      actualCurrency: statusResponse.responseCurrency,
      orderStatus: statusResponse.orderStatus,
      actionCode: statusResponse.actionCode,
      actionCodeDescription: statusResponse.actionCodeDescription,
      errorCode: statusResponse.errorCode,
      errorMessage: statusResponse.errorMessage,
    },
    {
      "diagnostics.lastGatewayEvaluation": {
        at: new Date(),
        provider,
        orderId,
        orderNumber,
        gatewaySuccess: statusResponse.gatewaySuccess,
        paymentSuccess,
        paymentMismatch,
        expectedAmountMinor,
        actualAmountMinor: statusResponse.responseAmountMinor,
        expectedCurrency,
        actualCurrency: statusResponse.responseCurrency,
        orderStatus: statusResponse.orderStatus,
        actionCode: statusResponse.actionCode,
        actionCodeDescription: statusResponse.actionCodeDescription,
        errorCode: statusResponse.errorCode,
        errorMessage: statusResponse.errorMessage,
      },
    }
  );

  const updateFields: Record<string, unknown> = {
    provider,
    gatewayAmount: statusResponse.responseAmountMinor,
    gatewayCurrency: statusResponse.responseCurrency || null,
    amountMismatch: paymentMismatch
      ? {
          expectedAmount: expectedAmountMinor,
          actualAmount: statusResponse.responseAmountMinor,
          expectedCurrency,
          actualCurrency: statusResponse.responseCurrency,
        }
      : null,
    orderStatus: statusResponse.orderStatus,
    actionCode: statusResponse.actionCode,
    actionCodeDescription: statusResponse.actionCodeDescription,
    errorCode: statusResponse.errorCode,
    errorMessage: statusResponse.errorMessage,
    gatewayResponse: statusResponse.raw,
    statusCheckedAt: now,
  };

  if (canUpdateStatus) {
    updateFields.status = paymentMismatch
      ? "payment_mismatch"
      : paymentSuccess
        ? "payment_success"
        : "payment_failed";
    updateFields.updatedAt = now;
  }

  await collection.updateOne(
    { orderId },
    {
      $set: updateFields,
    }
  );

  if (!paymentSuccess) {
    return logRedirect(
      paymentMismatch ? "warn" : "error",
      paymentMismatch ? "integration" : "gateway",
      locale,
      "/payment/fail",
      { orderId, orderNumber },
      paymentMismatch ? "gateway_amount_or_currency_mismatch" : "gateway_reported_unsuccessful_payment",
      {
        provider,
        expectedAmountMinor,
        actualAmountMinor: statusResponse.responseAmountMinor,
        expectedCurrency,
        actualCurrency: statusResponse.responseCurrency,
        orderStatus: statusResponse.orderStatus,
        actionCode: statusResponse.actionCode,
        errorCode: statusResponse.errorCode,
        errorMessage: statusResponse.errorMessage,
      }
    );
  }

  const lock = await collection.findOneAndUpdate(
    { orderId, status: { $nin: ["booking_complete", "booking_failed", "booking_in_progress"] } },
    {
      $set: {
        status: "booking_in_progress",
        paidAt: now,
        updatedAt: now,
      },
    },
    { returnDocument: "after" }
  );

  let lockedRecord = unwrapFindOneAndUpdateResult<VposPaymentRecord>(lock);
  if (!lockedRecord) {
    const latest = (await collection.findOne({ orderId })) as VposPaymentRecord | null;
    if (latest?.status === "booking_complete" || (latest?.status === "booking_in_progress" && hasBookingResult(latest))) {
      if (latest?.status === "booking_in_progress" && hasBookingResult(latest)) {
        await collection.updateOne(
          { orderId, status: "booking_in_progress" },
          {
            $set: {
              status: "booking_complete",
              updatedAt: new Date(),
            },
          }
        );
      }
      return logRedirect(
        "info",
        "application",
        locale,
        "/payment/success",
        { orderId, orderNumber },
        "booking_already_completed_after_lock_conflict",
        { provider, latestStatus: latest?.status ?? null }
      );
    }
    if (latest?.status === "booking_in_progress") {
      for (let attempt = 0; attempt < BOOKING_STATUS_POLL_ATTEMPTS; attempt += 1) {
        await sleep(BOOKING_STATUS_POLL_INTERVAL_MS);
        const polled = (await collection.findOne({ orderId })) as VposPaymentRecord | null;
        if (polled?.status === "booking_complete" || (polled?.status === "booking_in_progress" && hasBookingResult(polled))) {
          if (polled?.status === "booking_in_progress" && hasBookingResult(polled)) {
            await collection.updateOne(
              { orderId, status: "booking_in_progress" },
              {
                $set: {
                  status: "booking_complete",
                  updatedAt: new Date(),
                },
              }
            );
          }
          return logRedirect(
            "info",
            "application",
            locale,
            "/payment/success",
            { orderId, orderNumber },
            "booking_completed_during_polling",
            { provider, pollAttempt: attempt + 1, latestStatus: polled?.status ?? null }
          );
        }
        if (polled?.status === "booking_failed") {
          return logRedirect(
            "error",
            "application",
            locale,
            "/payment/fail",
            { orderId, orderNumber },
            "booking_failed_during_polling",
            { provider, pollAttempt: attempt + 1 }
          );
        }
      }

      const staleCandidate = (await collection.findOne({ orderId })) as VposPaymentRecord | null;
      const isStale = isStaleInProgressRecord(staleCandidate);

      if (isStale) {
        const recoveryFilter: Record<string, unknown> = {
          orderId,
          status: "booking_in_progress",
        };
        if (staleCandidate?.updatedAt != null) {
          recoveryFilter.updatedAt = staleCandidate.updatedAt;
        } else if (staleCandidate?.paidAt != null) {
          recoveryFilter.paidAt = staleCandidate.paidAt;
        }

        const recovery = await collection.findOneAndUpdate(
          recoveryFilter,
          {
            $set: {
              bookingRecoveryStartedAt: new Date(),
              updatedAt: new Date(),
            },
            $inc: {
              bookingRecoveryAttempts: 1,
            },
          },
          { returnDocument: "after" }
        );
        lockedRecord = unwrapFindOneAndUpdateResult<VposPaymentRecord>(recovery);
      } else {
        console.info("[Vpos][result] Booking still in progress after successful payment callback", {
          orderId,
          provider,
        });
        return logRedirect(
          "info",
          "application",
          locale,
          "/payment/success",
          { orderId, orderNumber },
          "booking_still_in_progress_after_payment_callback",
          { provider }
        );
      }
    }

    if (!lockedRecord && latest?.status === "booking_failed") {
      return logRedirect(
        "error",
        "application",
        locale,
        "/payment/fail",
        { orderId, orderNumber },
        "booking_failed_after_lock_conflict",
        { provider, latestStatus: latest?.status ?? null }
      );
    }

    if (!lockedRecord) {
      const latestAfterRecovery = (await collection.findOne({ orderId })) as VposPaymentRecord | null;
      if (
        latestAfterRecovery?.status === "booking_complete" ||
        (latestAfterRecovery?.status === "booking_in_progress" && hasBookingResult(latestAfterRecovery))
      ) {
        if (latestAfterRecovery?.status === "booking_in_progress" && hasBookingResult(latestAfterRecovery)) {
          await collection.updateOne(
            { orderId, status: "booking_in_progress" },
            {
              $set: {
                status: "booking_complete",
                updatedAt: new Date(),
              },
            }
          );
        }
        return logRedirect(
          "info",
          "application",
          locale,
          "/payment/success",
          { orderId, orderNumber },
          "booking_completed_after_recovery_check",
          { provider, latestStatus: latestAfterRecovery?.status ?? null }
        );
      }
      if (latestAfterRecovery?.status === "booking_failed") {
        return logRedirect(
          "error",
          "application",
          locale,
          "/payment/fail",
          { orderId, orderNumber },
          "booking_failed_after_recovery_check",
          { provider, latestStatus: latestAfterRecovery?.status ?? null }
        );
      }
      if (latestAfterRecovery?.status === "booking_in_progress" && !isStaleInProgressRecord(latestAfterRecovery)) {
        console.info("[Vpos][result] Booking still in progress after recovery check", {
          orderId,
          provider,
        });
        return logRedirect(
          "info",
          "application",
          locale,
          "/payment/success",
          { orderId, orderNumber },
          "booking_still_in_progress_after_recovery_check",
          { provider }
        );
      }
    }

    if (!lockedRecord) {
      console.error("[Vpos][result] Booking did not reach terminal state after successful payment", {
        orderId,
        provider,
      });
      return logRedirect(
        "error",
        "application",
        locale,
        "/payment/fail",
        { orderId, orderNumber },
        "booking_did_not_reach_terminal_state",
        { provider }
      );
    }
  }

  const payload = lockedRecord.payload as AoryxBookingPayload | undefined;
  if (!payload) {
    await collection.updateOne(
      { orderId },
      {
        $set: {
          status: "booking_failed",
          bookingError: "Missing booking payload",
          updatedAt: new Date(),
          "diagnostics.lastApplicationError": {
            at: new Date(),
            reason: "missing_booking_payload_after_successful_payment",
            message: "Missing booking payload",
          },
        },
      }
    );
    return logRedirect(
      "error",
      "application",
      locale,
      "/payment/fail",
      { orderId, orderNumber },
      "missing_booking_payload_after_successful_payment",
      { provider, flow: lockedRecord.flow ?? null }
    );
  }

  const paymentFlow = resolveString(lockedRecord.flow).toLowerCase();
  if (paymentFlow === "booking_addons") {
    try {
      const targetBookingId = resolveString(lockedRecord.addon?.targetBookingId);
      if (!targetBookingId || !ObjectId.isValid(targetBookingId)) {
        throw new Error("Missing add-on booking reference.");
      }
      const userId = resolveString(lockedRecord.userId);
      if (!userId) {
        throw new Error("Missing add-on booking owner.");
      }
      const addonServices = parseBookingAddonServices(lockedRecord.addon?.services ?? null);
      const requestedServiceKeys = resolveBookingAddonServiceKeys(addonServices);
      if (requestedServiceKeys.length === 0) {
        throw new Error("Missing add-on services payload.");
      }

      const bookingObjectId = new ObjectId(targetBookingId);
      const userBookings = db.collection("user_bookings");
      const userBooking = (await userBookings.findOne({
        _id: bookingObjectId,
        userIdString: userId,
      })) as { payload?: AoryxBookingPayload | null; booking?: AoryxBookingResult | null } | null;
      if (!userBooking?.payload) {
        throw new Error("Target booking not found.");
      }

      const merged = mergeBookingAddonPayload(userBooking.payload, addonServices);
      const appliedAt = new Date();
      const paymentCurrency =
        lockedRecord.amount?.currency ?? lockedRecord.amount?.currencyCode ?? null;
      await userBookings.updateOne(
        { _id: bookingObjectId, userIdString: userId },
        {
          $set: {
            payload: merged.payload,
            updatedAt: appliedAt,
            addonLastPayment: {
              at: appliedAt,
              provider,
              orderId,
              orderNumber: orderNumber || null,
              amountValue:
                typeof lockedRecord.amount?.value === "number" &&
                Number.isFinite(lockedRecord.amount.value)
                  ? lockedRecord.amount.value
                  : null,
              currency: paymentCurrency,
              requestedServices: requestedServiceKeys,
              appliedServices: merged.appliedServiceKeys,
              skippedServices: merged.skippedServiceKeys,
            },
          },
        }
      );

      await collection.updateOne(
        { orderId },
        {
          $set: {
            status: "booking_complete",
            payload: merged.payload,
            bookingResult: userBooking.booking ?? null,
            addonAppliedAt: appliedAt,
            addonApply: {
              targetBookingId,
              requestedServices: requestedServiceKeys,
              appliedServices: merged.appliedServiceKeys,
              skippedServices: merged.skippedServiceKeys,
            },
            updatedAt: appliedAt,
            "diagnostics.lastApplicationResult": {
              at: appliedAt,
              reason: "booking_addons_applied",
              requestedServiceKeys,
              targetBookingId,
            },
          },
        }
      );

      console.info("[Vpos][result] Booking add-ons applied after payment", {
        provider,
        orderId,
        orderNumber,
        requestedServiceKeys,
        targetBookingId,
      });
      return logRedirect(
        "info",
        "application",
        locale,
        "/payment/success",
        { orderId, orderNumber },
        "booking_addons_applied",
        { provider, requestedServiceKeys, targetBookingId }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to apply booking add-ons";
      await collection.updateOne(
        { orderId },
        {
          $set: {
            status: "booking_failed",
            bookingError: message,
            updatedAt: new Date(),
            "diagnostics.lastApplicationError": {
              at: new Date(),
              reason: "booking_addon_apply_failed",
              message,
            },
          },
        }
      );
      console.error("[Vpos][result] Add-on booking update failed", error);
      return logRedirect(
        "error",
        "application",
        locale,
        "/payment/fail",
        { orderId, orderNumber },
        "booking_addon_apply_failed",
        { provider, message }
      );
    }
  }

  try {
    const result: AoryxBookingResult = await bookWithRecovery(payload, {
      orderId,
      provider,
      orderNumber: orderNumber || null,
    });
    await collection.updateOne(
      { orderId },
      {
        $set: {
          status: "booking_complete",
          bookingResult: result,
          updatedAt: new Date(),
          "diagnostics.lastApplicationResult": {
            at: new Date(),
            reason: "booking_completed_after_successful_payment",
            bookingStatus: result.status ?? null,
            customerRefNumber: payload.customerRefNumber ?? null,
          },
        },
      }
    );

    const couponCode = resolveCouponCode(lockedRecord);
    if (couponCode) {
      try {
        const markResult = await collection.updateOne(
          { orderId, couponOrderCounted: { $ne: true } },
          {
            $set: {
              couponOrderCounted: true,
              couponOrderCountedAt: new Date(),
              updatedAt: new Date(),
            },
          }
        );
        if (markResult.modifiedCount > 0) {
          try {
            await incrementCouponSuccessfulOrders(couponCode);
          } catch (error) {
            await collection.updateOne(
              { orderId },
              {
                $set: {
                  couponOrderCounted: false,
                  couponOrderCountError:
                    error instanceof Error
                      ? error.message
                      : "Failed to update coupon order stats",
                  updatedAt: new Date(),
                },
              }
            );
            throw error;
          }
        }
      } catch (error) {
        console.error("[Vpos][result] Failed to update coupon order stats", error);
      }
    }

    let insurancePolicies: unknown[] | null = null;
    let insuranceError: string | null = null;
    try {
      console.info("[EFES][vpos-result] policy request", {
        orderId,
        orderNumber: orderNumber || null,
        paymentProvider: provider,
        flow: paymentFlow || "booking",
        ...summarizeEfesInsurance(payload),
      });
      const policies = await createEfesPoliciesFromBooking(payload);
      insurancePolicies = policies;
      console.info("[EFES][vpos-result] policy response", {
        orderId,
        orderNumber: orderNumber || null,
        provider,
        flow: paymentFlow || "booking",
        policies,
      });
      if (policies.length > 0) {
        await collection.updateOne(
          { orderId },
          {
            $set: {
              insurancePolicies: policies,
              insuranceUpdatedAt: new Date(),
            },
          }
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create EFES policies";
      insurancePolicies = [];
      insuranceError = message;
      await collection.updateOne(
        { orderId },
        {
          $set: {
            insuranceError: message,
            insuranceUpdatedAt: new Date(),
          },
        }
      );
      console.error("[Vpos][result] EFES policy creation failed", error);
    }

    if (lockedRecord.userId) {
      try {
        const appliedCoupon = resolveAppliedCoupon(lockedRecord);
        await recordUserBooking({
          userId: lockedRecord.userId,
          payload,
          result,
          source: provider === "ameriabank" ? "vpos-ameriabank" : "vpos-idbank",
          coupon: appliedCoupon,
          insurancePolicies,
          insuranceError,
        });
      } catch (error) {
        console.error("[Vpos][result] Failed to record user booking", error);
      }
    }

    if (lockedRecord.userEmail) {
      const appliedCoupon = resolveAppliedCoupon(lockedRecord);
      await sendBookingConfirmationEmail({
        to: lockedRecord.userEmail,
        name: lockedRecord.userName ?? null,
        payload,
        result,
        locale: lockedRecord.locale ?? null,
        paidAmount: lockedRecord.amount?.value ?? null,
        paidCurrency: lockedRecord.amount?.currency ?? lockedRecord.amount?.currencyCode ?? null,
        coupon: appliedCoupon,
      });
    }

    console.info("[Vpos][result] Booking completed after successful payment", {
      provider,
      orderId,
      orderNumber,
      bookingStatus: result.status ?? null,
      customerRefNumber: payload.customerRefNumber ?? null,
    });
    return logRedirect(
      "info",
      "application",
      locale,
      "/payment/success",
      { orderId, orderNumber },
      "booking_completed_after_successful_payment",
      {
        provider,
        bookingStatus: result.status ?? null,
        customerRefNumber: payload.customerRefNumber ?? null,
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to complete booking";
    await collection.updateOne(
      { orderId },
      {
        $set: {
          status: "booking_failed",
          bookingError: message,
          updatedAt: new Date(),
          "diagnostics.lastApplicationError": {
            at: new Date(),
            reason: "booking_complete_step_failed_after_successful_payment",
            message,
            endpoint: error instanceof AoryxClientError ? error.endpoint : null,
            statusCode: error instanceof AoryxClientError ? error.statusCode : null,
          },
        },
      }
    );
    console.error("[Vpos][result] Booking failed", error);
    return logRedirect(
      "error",
      "application",
      locale,
      "/payment/fail",
      { orderId, orderNumber },
      "booking_complete_step_failed_after_successful_payment",
      { provider, message }
    );
  }
};

export async function GET(request: NextRequest) {
  return handleResultCallback(request);
}

export async function POST(request: NextRequest) {
  return handleResultCallback(request);
}
