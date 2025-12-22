import { NextRequest, NextResponse } from "next/server";
import { preBook, AoryxServiceError, AoryxClientError } from "@/lib/aoryx-client";
import { getSessionFromCookie, setPrebookCookie, setSessionCookie } from "../_shared";

export const runtime = "nodejs";

const parseRateKeys = (input: unknown): string[] => {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error("rateKeys must be a non-empty array");
  }
  return input
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const sessionId =
      typeof body.sessionId === "string" && body.sessionId.trim().length > 0
        ? body.sessionId.trim()
        : getSessionFromCookie(request);

    if (!sessionId) {
      return NextResponse.json(
        { error: "Missing Aoryx session. Please search again." },
        { status: 400 }
      );
    }

    const hotelCode =
      typeof body.hotelCode === "string" && body.hotelCode.trim().length > 0
        ? body.hotelCode.trim()
        : "";
    if (!hotelCode) {
      return NextResponse.json({ error: "hotelCode is required" }, { status: 400 });
    }

    const groupCode = Number(body.groupCode);
    if (!Number.isFinite(groupCode)) {
      return NextResponse.json({ error: "groupCode must be a number" }, { status: 400 });
    }

    let rateKeys: string[] = [];
    try {
      rateKeys = parseRateKeys(body.rateKeys);
    } catch (parseError) {
      const message = parseError instanceof Error ? parseError.message : "Invalid rateKeys payload";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const currency = typeof body.currency === "string" ? body.currency.trim() : undefined;

    const result = await preBook(sessionId, hotelCode, groupCode, rateKeys, currency);

    const response = NextResponse.json(result);
    setSessionCookie(response, sessionId);
    setPrebookCookie(response, {
      sessionId,
      hotelCode,
      groupCode,
      rateKeys,
      isBookable: result.isBookable,
      isPriceChanged: result.isPriceChanged,
      recordedAt: Date.now(),
    });

    return response;
  } catch (error) {
    console.error("Prebook error:", error);

    if (error instanceof AoryxServiceError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 400 }
      );
    }

    if (error instanceof AoryxClientError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }

    return NextResponse.json(
      { error: "Failed to prebook rate" },
      { status: 500 }
    );
  }
}
