import { NextRequest, NextResponse } from "next/server";
import { authenticateB2bRequest, withB2bGatewayHeaders } from "@/lib/b2b-gateway";
import { EfesClientError, EfesServiceError, quoteEfesTravelCost } from "@/lib/efes-client";
import type { EfesQuoteRequest, EfesQuoteTraveler } from "@/types/efes";

export const runtime = "nodejs";

const parseString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const parseNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const parseTravelers = (value: unknown): EfesQuoteTraveler[] => {
  if (!Array.isArray(value)) return [];
  const travelers: EfesQuoteTraveler[] = [];
  for (const traveler of value) {
    if (!traveler || typeof traveler !== "object") continue;
    const record = traveler as Record<string, unknown>;
    const age = parseNumber(record.age);
    if (age === null || age <= 0) continue;

    const subrisks = Array.isArray(record.subrisks)
      ? record.subrisks
          .map((entry) => parseString(entry))
          .filter((entry): entry is string => Boolean(entry))
      : undefined;

    const id = parseString(record.id);
    const passportNumber = parseString(record.passportNumber);
    const socialCard = parseString(record.socialCard);

    travelers.push({
      id: id || undefined,
      age,
      passportNumber: passportNumber || null,
      socialCard: socialCard || null,
      subrisks,
    });
  }
  return travelers;
};

export async function POST(request: NextRequest) {
  const auth = authenticateB2bRequest(request, "insurance:quote");
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();

    const startDate = parseString((body as { startDate?: unknown }).startDate);
    const endDate = parseString((body as { endDate?: unknown }).endDate);
    const territoryCode = parseString((body as { territoryCode?: unknown }).territoryCode);
    const riskAmount = parseNumber((body as { riskAmount?: unknown }).riskAmount);
    const riskCurrency = parseString((body as { riskCurrency?: unknown }).riskCurrency);
    const riskLabel = parseString((body as { riskLabel?: unknown }).riskLabel);
    const promoCode = parseString((body as { promoCode?: unknown }).promoCode);
    const days = parseNumber((body as { days?: unknown }).days);
    const travelers = parseTravelers((body as { travelers?: unknown }).travelers);
    const subrisks = Array.isArray((body as { subrisks?: unknown }).subrisks)
      ? ((body as { subrisks?: unknown }).subrisks as unknown[])
          .map((entry) => parseString(entry))
          .filter((entry): entry is string => Boolean(entry))
      : undefined;

    if (!startDate || !endDate || !territoryCode || !riskAmount || !riskCurrency) {
      return withB2bGatewayHeaders(
        NextResponse.json(
          { error: "Missing required fields for EFES quote", requestId: auth.context.requestId },
          { status: 400 }
        ),
        auth.context
      );
    }

    if (travelers.length === 0) {
      return withB2bGatewayHeaders(
        NextResponse.json(
          { error: "At least one traveler is required", requestId: auth.context.requestId },
          { status: 400 }
        ),
        auth.context
      );
    }

    const payload: EfesQuoteRequest = {
      startDate,
      endDate,
      territoryCode,
      riskAmount,
      riskCurrency,
      travelers,
      days: typeof days === "number" ? days : undefined,
      riskLabel: riskLabel || undefined,
      promoCode: promoCode || undefined,
      subrisks,
    };

    const result = await quoteEfesTravelCost(payload);
    const safeResult = { ...result };
    delete safeResult.raw;

    return withB2bGatewayHeaders(
      NextResponse.json({
        requestId: auth.context.requestId,
        data: safeResult,
      }),
      auth.context
    );
  } catch (error) {
    if (error instanceof EfesServiceError) {
      const status =
        typeof error.statusCode === "number" && error.statusCode >= 500 ? 502 : 400;
      return withB2bGatewayHeaders(
        NextResponse.json(
          {
            error: error.message,
            requestId: auth.context.requestId,
          },
          { status }
        ),
        auth.context
      );
    }

    if (error instanceof EfesClientError) {
      return withB2bGatewayHeaders(
        NextResponse.json(
          {
            error: error.message,
            requestId: auth.context.requestId,
          },
          { status: 502 }
        ),
        auth.context
      );
    }

    return withB2bGatewayHeaders(
      NextResponse.json(
        {
          error: "Failed to calculate insurance quote",
          requestId: auth.context.requestId,
        },
        { status: 500 }
      ),
      auth.context
    );
  }
}
