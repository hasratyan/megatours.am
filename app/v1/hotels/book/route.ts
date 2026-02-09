import { NextRequest, NextResponse } from "next/server";
import { AoryxClientError, AoryxServiceError, book } from "@/lib/aoryx-client";
import { parseBookingPayload } from "@/lib/aoryx-booking";
import { obfuscateBookingResult } from "@/lib/aoryx-rate-tokens";
import { authenticateB2bRequest, withB2bGatewayHeaders } from "@/lib/b2b-gateway";
import type { AoryxBookingPayload } from "@/types/aoryx";

export const runtime = "nodejs";

const parseSessionId = (input: unknown): string | undefined => {
  if (typeof input !== "string") return undefined;
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export async function POST(request: NextRequest) {
  const auth = authenticateB2bRequest(request, "hotels:book");
  if (!auth.ok) return auth.response;

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return withB2bGatewayHeaders(
        NextResponse.json(
          {
            error: "Invalid JSON payload",
            requestId: auth.context.requestId,
          },
          { status: 400 }
        ),
        auth.context
      );
    }
    const sessionId = parseSessionId((body as { sessionId?: unknown }).sessionId);

    let payload: AoryxBookingPayload;
    try {
      payload = parseBookingPayload(body, sessionId);
    } catch (parseError) {
      const message = parseError instanceof Error ? parseError.message : "Invalid booking payload";
      return withB2bGatewayHeaders(
        NextResponse.json(
          {
            error: message,
            requestId: auth.context.requestId,
          },
          { status: 400 }
        ),
        auth.context
      );
    }

    const result = await book(payload);
    return withB2bGatewayHeaders(
      NextResponse.json({
        requestId: auth.context.requestId,
        data: obfuscateBookingResult(result),
      }),
      auth.context
    );
  } catch (error) {
    if (error instanceof AoryxServiceError) {
      return withB2bGatewayHeaders(
        NextResponse.json(
          {
            error: error.message,
            code: error.code ?? null,
            requestId: auth.context.requestId,
          },
          { status: 400 }
        ),
        auth.context
      );
    }

    if (error instanceof AoryxClientError) {
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
          error: "Failed to complete booking",
          requestId: auth.context.requestId,
        },
        { status: 500 }
      ),
      auth.context
    );
  }
}
