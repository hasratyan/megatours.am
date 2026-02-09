import { NextRequest, NextResponse } from "next/server";
import { AoryxClientError, AoryxServiceError, preBook } from "@/lib/aoryx-client";
import { decodeRateToken, isRateToken, obfuscateRoomOptions } from "@/lib/aoryx-rate-tokens";
import { authenticateB2bRequest, withB2bGatewayHeaders } from "@/lib/b2b-gateway";
import { buildRoomFacets } from "@/lib/b2b-facets";

export const runtime = "nodejs";

const parseString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const parseRateKeys = (input: unknown): string[] => {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error("rateKeys must be a non-empty array");
  }
  const parsed = input
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);
  if (parsed.length === 0) {
    throw new Error("rateKeys must contain at least one non-empty value");
  }
  return parsed;
};

const parseGroupCode = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

export async function POST(request: NextRequest) {
  const auth = authenticateB2bRequest(request, "hotels:search");
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();

    let sessionId = parseString((body as { sessionId?: unknown }).sessionId) || null;
    const hotelCode = parseString((body as { hotelCode?: unknown }).hotelCode);
    if (!hotelCode) {
      return withB2bGatewayHeaders(
        NextResponse.json(
          { error: "hotelCode is required", requestId: auth.context.requestId },
          { status: 400 }
        ),
        auth.context
      );
    }

    let rateKeys: string[] = [];
    try {
      rateKeys = parseRateKeys((body as { rateKeys?: unknown }).rateKeys);
    } catch (parseError) {
      return withB2bGatewayHeaders(
        NextResponse.json(
          {
            error: parseError instanceof Error ? parseError.message : "Invalid rateKeys payload",
            requestId: auth.context.requestId,
          },
          { status: 400 }
        ),
        auth.context
      );
    }

    const hasToken = rateKeys.some(isRateToken);
    const hasRaw = rateKeys.some((value) => !isRateToken(value));
    if (hasToken && hasRaw) {
      return withB2bGatewayHeaders(
        NextResponse.json(
          {
            error: "Invalid rate selection. Please request room details again.",
            requestId: auth.context.requestId,
          },
          { status: 400 }
        ),
        auth.context
      );
    }

    let groupCodeFromTokens: number | null = null;
    if (hasToken) {
      try {
        const decoded = rateKeys.map((token) => decodeRateToken(token));
        const tokenSessionIds = new Set<string>();

        decoded.forEach((payload) => {
          if (payload.sessionId) tokenSessionIds.add(payload.sessionId);
          if (payload.sessionId && sessionId && payload.sessionId !== sessionId) {
            throw new Error("Rate token session mismatch.");
          }
          if (payload.hotelCode && payload.hotelCode !== hotelCode) {
            throw new Error("Rate token hotel mismatch.");
          }
        });

        if (tokenSessionIds.size > 1) {
          throw new Error("Rate token session mismatch.");
        }

        const tokenSessionId = tokenSessionIds.size === 1 ? Array.from(tokenSessionIds)[0] : null;
        if (!sessionId && tokenSessionId) {
          sessionId = tokenSessionId;
        }

        const groupCodes = new Set(decoded.map((payload) => payload.groupCode));
        if (groupCodes.size !== 1) {
          throw new Error("Rate token group mismatch.");
        }
        groupCodeFromTokens = Array.from(groupCodes)[0];
        rateKeys = decoded.map((payload) => payload.rateKey);
      } catch (tokenError) {
        console.error("[B2B][prebook] Invalid rate token", tokenError);
        return withB2bGatewayHeaders(
          NextResponse.json(
            {
              error: "Invalid rate selection. Please request room details again.",
              requestId: auth.context.requestId,
            },
            { status: 400 }
          ),
          auth.context
        );
      }
    }

    const parsedGroupCode = parseGroupCode((body as { groupCode?: unknown }).groupCode);
    const resolvedGroupCode = parsedGroupCode ?? groupCodeFromTokens;

    if (resolvedGroupCode === null || !Number.isFinite(resolvedGroupCode)) {
      return withB2bGatewayHeaders(
        NextResponse.json(
          {
            error: "groupCode is required when using raw rateKeys",
            requestId: auth.context.requestId,
          },
          { status: 400 }
        ),
        auth.context
      );
    }

    if (groupCodeFromTokens !== null && groupCodeFromTokens !== resolvedGroupCode) {
      return withB2bGatewayHeaders(
        NextResponse.json(
          {
            error: "Rate selection changed. Please request room details again.",
            requestId: auth.context.requestId,
          },
          { status: 409 }
        ),
        auth.context
      );
    }

    if (!sessionId) {
      return withB2bGatewayHeaders(
        NextResponse.json(
          {
            error: "sessionId is required when using raw rateKeys",
            requestId: auth.context.requestId,
          },
          { status: 400 }
        ),
        auth.context
      );
    }

    const currency = parseString((body as { currency?: unknown }).currency) || undefined;
    const result = await preBook(sessionId, hotelCode, resolvedGroupCode, rateKeys, currency);
    const resolvedSessionId = result.sessionId || sessionId;
    const preparedRooms = obfuscateRoomOptions(result.rooms, {
      sessionId: resolvedSessionId,
      hotelCode,
      groupCode: resolvedGroupCode,
    });
    const facets = buildRoomFacets(preparedRooms, result.currency ?? currency ?? null);

    return withB2bGatewayHeaders(
      NextResponse.json({
        requestId: auth.context.requestId,
        data: {
          isBookable: result.isBookable ?? null,
          isSoldOut: result.isSoldOut ?? null,
          isPriceChanged: result.isPriceChanged ?? null,
          currency: result.currency ?? currency ?? null,
          rooms: preparedRooms,
          facets,
        },
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
          error: "Failed to prebook rate",
          requestId: auth.context.requestId,
        },
        { status: 500 }
      ),
      auth.context
    );
  }
}
