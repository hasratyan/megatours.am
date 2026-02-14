import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { book } from "@/lib/aoryx-client";
import { createEfesPoliciesFromBooking } from "@/lib/efes-client";
import { recordUserBooking } from "@/lib/user-data";
import { sendBookingConfirmationEmail } from "@/lib/email";
import { incrementCouponSuccessfulOrders } from "@/lib/coupons";
import { defaultLocale, Locale, locales } from "@/lib/i18n";
import type { AoryxBookingPayload, AoryxBookingResult } from "@/types/aoryx";

export const runtime = "nodejs";

type PaymentProvider = "idbank" | "ameriabank";

type VposPaymentRecord = {
  provider?: PaymentProvider | string;
  orderId?: string;
  orderNumber?: string;
  status?: string;
  amount?: {
    value?: number;
    minor?: number;
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
  updatedAt?: Date | string | number | null;
  paidAt?: Date | string | number | null;
};

type IdbankStatusResponse = {
  amount?: number | string;
  currency?: number | string;
  orderStatus?: number | string;
  actionCode?: number | string;
  actionCodeDescription?: string;
  errorCode?: number | string;
  errorMessage?: string;
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

const normalizeBaseUrl = (value: string) => value.trim().replace(/\/+$/, "");

const resolveString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const hasBookingResult = (record: VposPaymentRecord | null) => record?.bookingResult != null;

const resolveCouponCode = (
  record: Pick<VposPaymentRecord, "coupon">
): string | null => {
  const code = typeof record.coupon?.code === "string" ? record.coupon.code.trim().toUpperCase() : "";
  return code.length > 0 ? code : null;
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
  request: NextRequest,
  locale: Locale,
  path: "/payment/success" | "/payment/fail",
  params: Record<string, string | undefined>
) => {
  const url = new URL(`/${locale}${path}`, request.url);
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
  const responseAmountMinor = toNumber(payload.amount);
  const responseCurrency = normalizeCurrencyCode(payload.currency);
  const actionCodeDescription =
    typeof payload.actionCodeDescription === "string" ? payload.actionCodeDescription : null;
  const errorMessage = typeof payload.errorMessage === "string" ? payload.errorMessage : null;
  const normalizedErrorCode = errorCode ?? 0;
  const gatewaySuccess = normalizedErrorCode === 0 && orderStatus === 2;

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

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const paymentIdParam = searchParams.get("paymentID") || searchParams.get("paymentId");
  const orderIdParam = searchParams.get("orderId") || searchParams.get("mdOrder") || paymentIdParam;
  const orderNumberParam = searchParams.get("orderNumber") || searchParams.get("orderID");

  if (!orderIdParam && !orderNumberParam) {
    return buildRedirect(request, defaultLocale, "/payment/fail", {});
  }

  let db: Awaited<ReturnType<typeof getDb>>;
  try {
    db = await getDb();
  } catch (error) {
    console.error("[Vpos][result] Failed to connect to database", error);
    return buildRedirect(request, defaultLocale, "/payment/fail", {});
  }

  const collection = db.collection("vpos_payments");
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
    return buildRedirect(request, defaultLocale, "/payment/fail", {});
  }

  const locale = resolveLocale(record.locale);
  const provider = resolveProvider(record.provider);
  const orderId = record.orderId || orderIdParam || paymentIdParam || "";
  const orderNumber = record.orderNumber || orderNumberParam || "";

  if (!orderId) {
    return buildRedirect(request, locale, "/payment/fail", { orderNumber });
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
    return buildRedirect(request, locale, "/payment/success", { orderId, orderNumber });
  }
  if (record.status === "booking_failed") {
    return buildRedirect(request, locale, "/payment/fail", { orderId, orderNumber });
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
    return buildRedirect(request, locale, "/payment/fail", { orderId, orderNumber });
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
    return buildRedirect(request, locale, "/payment/fail", { orderId, orderNumber });
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
      return buildRedirect(request, locale, "/payment/success", { orderId, orderNumber });
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
          return buildRedirect(request, locale, "/payment/success", { orderId, orderNumber });
        }
        if (polled?.status === "booking_failed") {
          return buildRedirect(request, locale, "/payment/fail", { orderId, orderNumber });
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
        return buildRedirect(request, locale, "/payment/success", { orderId, orderNumber });
      }
    }

    if (!lockedRecord && latest?.status === "booking_failed") {
      return buildRedirect(request, locale, "/payment/fail", { orderId, orderNumber });
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
        return buildRedirect(request, locale, "/payment/success", { orderId, orderNumber });
      }
      if (latestAfterRecovery?.status === "booking_failed") {
        return buildRedirect(request, locale, "/payment/fail", { orderId, orderNumber });
      }
      if (latestAfterRecovery?.status === "booking_in_progress" && !isStaleInProgressRecord(latestAfterRecovery)) {
        console.info("[Vpos][result] Booking still in progress after recovery check", {
          orderId,
          provider,
        });
        return buildRedirect(request, locale, "/payment/success", { orderId, orderNumber });
      }
    }

    if (!lockedRecord) {
      console.error("[Vpos][result] Booking did not reach terminal state after successful payment", {
        orderId,
        provider,
      });
      return buildRedirect(request, locale, "/payment/fail", { orderId, orderNumber });
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
        },
      }
    );
    return buildRedirect(request, locale, "/payment/fail", { orderId, orderNumber });
  }

  try {
    const result: AoryxBookingResult = await book(payload);
    await collection.updateOne(
      { orderId },
      {
        $set: {
          status: "booking_complete",
          bookingResult: result,
          updatedAt: new Date(),
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

    try {
      const policies = await createEfesPoliciesFromBooking(payload);
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
        await recordUserBooking({
          userId: lockedRecord.userId,
          payload,
          result,
          source: provider === "ameriabank" ? "vpos-ameriabank" : "vpos-idbank",
        });
      } catch (error) {
        console.error("[Vpos][result] Failed to record user booking", error);
      }
    }

    if (lockedRecord.userEmail) {
      await sendBookingConfirmationEmail({
        to: lockedRecord.userEmail,
        name: lockedRecord.userName ?? null,
        payload,
        result,
        locale: lockedRecord.locale ?? null,
      });
    }

    return buildRedirect(request, locale, "/payment/success", { orderId, orderNumber });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to complete booking";
    await collection.updateOne(
      { orderId },
      {
        $set: {
          status: "booking_failed",
          bookingError: message,
          updatedAt: new Date(),
        },
      }
    );
    console.error("[Vpos][result] Booking failed", error);
    return buildRedirect(request, locale, "/payment/fail", { orderId, orderNumber });
  }
}
