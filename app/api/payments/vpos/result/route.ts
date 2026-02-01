import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { book } from "@/lib/aoryx-client";
import { createEfesPoliciesFromBooking } from "@/lib/efes-client";
import { recordUserBooking } from "@/lib/user-data";
import { sendBookingConfirmationEmail } from "@/lib/email";
import { defaultLocale, Locale, locales } from "@/lib/i18n";
import type { AoryxBookingPayload, AoryxBookingResult } from "@/types/aoryx";

export const runtime = "nodejs";

type VposPaymentRecord = {
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
  userId?: string | null;
  userEmail?: string | null;
  userName?: string | null;
  locale?: string | null;
};

type VposStatusResponse = {
  amount?: number | string;
  currency?: number | string;
  orderStatus?: number | string;
  actionCode?: number | string;
  actionCodeDescription?: string;
  errorCode?: number | string;
  errorMessage?: string;
};

const DEFAULT_BASE_URL = "https://ipaytest.arca.am:8445/payment/rest";
const DEFAULT_LANGUAGE = "en";

const normalizeBaseUrl = (value: string) => value.trim().replace(/\/+$/, "");

const resolveBaseUrl = () => {
  const raw = typeof process.env.VPOS_BASE_URL === "string" ? process.env.VPOS_BASE_URL : "";
  const baseUrl = raw.trim().length > 0 ? raw : DEFAULT_BASE_URL;
  return normalizeBaseUrl(baseUrl);
};

const resolveString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const normalizeLanguage = (value: string | undefined) => {
  const normalized = (value ?? DEFAULT_LANGUAGE).trim().toLowerCase();
  if (normalized === "hy" || normalized === "ru" || normalized === "en") return normalized;
  return DEFAULT_LANGUAGE;
};

const resolveLocale = (value: string | null | undefined) =>
  locales.includes(value as Locale) ? (value as Locale) : defaultLocale;

const normalizeCurrencyCode = (value: unknown) => {
  if (value == null) return "";
  const raw = typeof value === "number" ? String(Math.trunc(value)) : String(value);
  const trimmed = raw.trim();
  if (!trimmed) return "";
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

const fetchOrderStatus = async (
  orderId: string,
  language: string,
  baseUrl: string,
  userName: string,
  password: string
): Promise<VposStatusResponse> => {
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

  try {
    const payload = (await response.json()) as VposStatusResponse;
    if (!response.ok) {
      throw new Error(payload?.errorMessage || "Payment status lookup failed.");
    }
    return payload;
  } catch (error) {
    const text = await response.text().catch(() => "");
    console.error("[Vpos][result] Invalid status response", text, error);
    throw error;
  }
};

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const orderIdParam = searchParams.get("orderId") || searchParams.get("mdOrder");
  const orderNumberParam = searchParams.get("orderNumber");

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
  if (!record && orderNumberParam) {
    record = (await collection.findOne({ orderNumber: orderNumberParam })) as VposPaymentRecord | null;
  }

  if (!record) {
    return buildRedirect(request, defaultLocale, "/payment/fail", {});
  }

  const locale = resolveLocale(record.locale);
  const orderId = record.orderId || orderIdParam || "";
  const orderNumber = record.orderNumber || orderNumberParam || "";

  if (!orderId) {
    return buildRedirect(request, locale, "/payment/fail", { orderNumber });
  }

  if (record.status === "booking_complete") {
    return buildRedirect(request, locale, "/payment/success", { orderId, orderNumber });
  }
  if (record.status === "booking_failed") {
    return buildRedirect(request, locale, "/payment/fail", { orderId, orderNumber });
  }

  const userName = resolveString(process.env.VPOS_USER);
  const password = resolveString(process.env.VPOS_PASSWORD);
  const baseUrl = resolveBaseUrl();
  if (!userName || !password || !baseUrl) {
    return buildRedirect(request, locale, "/payment/fail", { orderId, orderNumber });
  }

  let statusResponse: VposStatusResponse;
  try {
    const language = normalizeLanguage(process.env.VPOS_LANGUAGE ?? record.locale ?? undefined);
    statusResponse = await fetchOrderStatus(orderId, language, baseUrl, userName, password);
  } catch (error) {
    return buildRedirect(request, locale, "/payment/fail", { orderId, orderNumber });
  }

  const orderStatus = toNumber(statusResponse.orderStatus);
  const actionCode = toNumber(statusResponse.actionCode);
  const errorCode = toNumber(statusResponse.errorCode);
  const responseAmount = toNumber(statusResponse.amount);
  const responseCurrency = normalizeCurrencyCode(statusResponse.currency);
  const expectedAmountMinor =
    typeof record.amount?.minor === "number" && Number.isFinite(record.amount.minor)
      ? Math.round(record.amount.minor)
      : null;
  const expectedCurrency = normalizeCurrencyCode(record.amount?.currencyCode ?? "");
  const amountMatches =
    expectedAmountMinor != null && responseAmount != null && expectedAmountMinor === responseAmount;
  const currencyMatches =
    expectedCurrency.length > 0 && responseCurrency.length > 0 && expectedCurrency === responseCurrency;
  const actionCodeDescription =
    typeof statusResponse.actionCodeDescription === "string"
      ? statusResponse.actionCodeDescription
      : null;
  const errorMessage =
    typeof statusResponse.errorMessage === "string" ? statusResponse.errorMessage : null;

  const now = new Date();
  const normalizedErrorCode = errorCode ?? 0;
  const paymentMismatch = !amountMatches || !currencyMatches;
  const paymentSuccess =
    normalizedErrorCode === 0 && orderStatus === 2 && !paymentMismatch;
  const canUpdateStatus = !["booking_in_progress", "booking_complete", "booking_failed"].includes(
    record.status ?? ""
  );
  const updateFields: Record<string, unknown> = {
    gatewayAmount: responseAmount,
    gatewayCurrency: responseCurrency || null,
    amountMismatch: paymentMismatch
      ? {
          expectedAmount: expectedAmountMinor,
          actualAmount: responseAmount,
          expectedCurrency,
          actualCurrency: responseCurrency,
        }
      : null,
    orderStatus,
    actionCode,
    actionCodeDescription,
    errorCode,
    errorMessage,
    statusCheckedAt: now,
    updatedAt: now,
  };
  if (canUpdateStatus) {
    updateFields.status = paymentMismatch
      ? "payment_mismatch"
      : paymentSuccess
        ? "payment_success"
        : "payment_failed";
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

  const lockedRecord = (lock?.value ?? null) as VposPaymentRecord | null;
  if (!lockedRecord) {
    const latest = (await collection.findOne({ orderId })) as VposPaymentRecord | null;
    if (latest?.status === "booking_complete" || latest?.status === "booking_in_progress") {
      return buildRedirect(request, locale, "/payment/success", { orderId, orderNumber });
    }
    return buildRedirect(request, locale, "/payment/fail", { orderId, orderNumber });
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
          source: "aoryx-vpos",
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
