import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getPrebookState, getSessionFromCookie } from "@/app/api/aoryx/_shared";
import { parseBookingPayload, validatePrebookState } from "@/lib/aoryx-booking";
import { calculateBookingTotal } from "@/lib/booking-total";
import { applyMarkup } from "@/lib/pricing-utils";
import { getAmdRateForCurrency, getAmdRates, getAoryxHotelPlatformFee } from "@/lib/pricing";
import type { AoryxBookingPayload } from "@/types/aoryx";

export const runtime = "nodejs";

const DEFAULT_BASE_URL = "https://ipaytest.arca.am:8445/payment/rest";
const DEFAULT_CURRENCY_CODE = "051";
const DEFAULT_CURRENCY_DECIMALS = 2;
const DEFAULT_LANGUAGE = "en";

const normalizeBaseUrl = (value: string) => value.trim().replace(/\/+$/, "");

const resolveBaseUrl = () => {
  const raw = typeof process.env.VPOS_BASE_URL === "string" ? process.env.VPOS_BASE_URL : "";
  const baseUrl = raw.trim().length > 0 ? raw : DEFAULT_BASE_URL;
  return normalizeBaseUrl(baseUrl);
};

const resolveString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const parseSessionId = (input: unknown): string | undefined => {
  if (typeof input !== "string") return undefined;
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const normalizeLanguage = (value: string | undefined) => {
  const normalized = (value ?? DEFAULT_LANGUAGE).trim().toLowerCase();
  if (normalized === "hy" || normalized === "ru" || normalized === "en") return normalized;
  return DEFAULT_LANGUAGE;
};

const resolveCurrencyDecimals = (value: string | undefined) => {
  const parsed = Number.parseInt((value ?? "").trim(), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_CURRENCY_DECIMALS;
};

const normalizeCurrencyCode = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^\d+$/.test(trimmed)) return trimmed.padStart(3, "0");
  return trimmed;
};

const toMinorUnits = (amount: number, decimals: number) =>
  Math.round(amount * Math.pow(10, decimals));

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

const buildReturnUrl = (request: NextRequest) => {
  const origin =
    request.headers.get("origin") ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXTAUTH_URL ||
    "http://localhost:3000";
  return new URL("/api/payments/vpos/result", origin).toString();
};

export async function POST(request: NextRequest) {
  try {
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
        validationError instanceof Error
          ? validationError.message
          : "Rate selection changed. Please prebook again.";
      return NextResponse.json({ error: message }, { status: 409 });
    }

    const userName = resolveString(process.env.VPOS_USER);
    const password = resolveString(process.env.VPOS_PASSWORD);
    if (!userName || !password) {
      return NextResponse.json(
        { error: "Card payment is not configured. Please contact support." },
        { status: 500 }
      );
    }

    const baseUrl = resolveBaseUrl();
    if (!baseUrl) {
      return NextResponse.json(
        { error: "Card payment is not configured. Please contact support." },
        { status: 500 }
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
      totalAmd = roomsAmd + transferAmd + excursionsAmd + insuranceAmd + flightsAmd;
    } catch (error) {
      console.error("[Vpos][checkout] Failed to convert amount", error);
      return NextResponse.json(
        { error: "Failed to calculate AMD total. Please try again." },
        { status: 500 }
      );
    }

    const currencyCode =
      typeof process.env.VPOS_CURRENCY_CODE === "string" && process.env.VPOS_CURRENCY_CODE.trim()
        ? process.env.VPOS_CURRENCY_CODE.trim()
        : DEFAULT_CURRENCY_CODE;
    const normalizedCurrencyCode = normalizeCurrencyCode(currencyCode);
    if (normalizedCurrencyCode !== "051") {
      return NextResponse.json(
        { error: "Card payment is configured for AMD only." },
        { status: 500 }
      );
    }
    const currencyDecimals = resolveCurrencyDecimals(process.env.VPOS_CURRENCY_DECIMALS);
    const amountMinor = toMinorUnits(totalAmd, currencyDecimals);
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
      return NextResponse.json({ error: "Invalid payment amount." }, { status: 400 });
    }
    const amountValue = Number((amountMinor / Math.pow(10, currencyDecimals)).toFixed(currencyDecimals));

    const orderNumber = buildOrderNumber(payload.customerRefNumber ?? null);
    const description = sanitizeDescription(
      `Hotel booking ${payload.hotelCode} (${orderNumber})`
    );
    const language = normalizeLanguage(process.env.VPOS_LANGUAGE ?? locale ?? undefined);
    const returnUrl = buildReturnUrl(request);
    const pageView = resolvePageView(request.headers.get("user-agent"));

    const params = new URLSearchParams();
    params.set("userName", userName);
    params.set("password", password);
    params.set("orderNumber", orderNumber);
    params.set("amount", String(amountMinor));
    params.set("currency", normalizedCurrencyCode);
    params.set("returnUrl", returnUrl);
    if (description) params.set("description", description);
    if (language) params.set("language", language);
    if (pageView) params.set("pageView", pageView);
    params.set("jsonParams", JSON.stringify({ orderNumber, locale }));

    const response = await fetch(`${baseUrl}/register.do`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    let responseBody: any = null;
    try {
      responseBody = await response.json();
    } catch (parseError) {
      const text = await response.text().catch(() => "");
      console.error("[Vpos][checkout] Non-JSON response", text);
      return NextResponse.json(
        { error: "Payment gateway response invalid." },
        { status: 502 }
      );
    }

    const errorCode =
      typeof responseBody?.errorCode === "number" || typeof responseBody?.errorCode === "string"
        ? String(responseBody.errorCode)
        : null;
    const formUrl = typeof responseBody?.formUrl === "string" ? responseBody.formUrl.trim() : "";
    const orderId = typeof responseBody?.orderId === "string" ? responseBody.orderId.trim() : "";
    const hasError = errorCode !== null && errorCode !== "0";

    if (!response.ok || hasError || !formUrl || !orderId) {
      const message =
        typeof responseBody?.errorMessage === "string" && responseBody.errorMessage.trim().length > 0
          ? responseBody.errorMessage
          : "Failed to initialize card payment.";
      console.error("[Vpos][checkout] Gateway error", responseBody);
      return NextResponse.json({ error: message }, { status: 502 });
    }

    const session = await getServerSession(authOptions);
    const userId = session?.user?.id ?? null;
    const userEmail = session?.user?.email ?? null;
    const userNameValue = session?.user?.name ?? null;

    const now = new Date();
    const db = await getDb();

    await db.collection("vpos_payments").insertOne({
      orderId,
      orderNumber,
      status: "created",
      amount: {
        value: amountValue,
        minor: amountMinor,
        currency: "AMD",
        currencyCode: normalizedCurrencyCode,
        decimals: currencyDecimals,
        baseValue: baseAmount,
        baseCurrency: payload.currency,
      },
      description,
      payload,
      prebookState,
      userId,
      userEmail,
      userName: userNameValue,
      locale,
      gateway: {
        baseUrl,
        userName,
        returnUrl,
        pageView,
      },
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json({
      formUrl,
      orderId,
      orderNumber,
    });
  } catch (error) {
    console.error("[Vpos][checkout] Failed to initialize payment", error);
    return NextResponse.json({ error: "Failed to initialize payment" }, { status: 500 });
  }
}
