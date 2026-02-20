import { NextRequest, NextResponse } from "next/server";
import { AoryxClientError, AoryxServiceError, bookWithOptions } from "@/lib/aoryx-client";
import { parseBookingPayload } from "@/lib/aoryx-booking";
import { obfuscateBookingResult } from "@/lib/aoryx-rate-tokens";
import { authenticateB2bRequest, withB2bGatewayHeaders } from "@/lib/b2b-gateway";
import {
  type B2bServicesBookingResult,
  validateInsuranceDetailsForBooking,
  processB2bBookingServices,
  validateTransferFlightDetailsForBooking,
} from "@/lib/b2b-service-booking";
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
    try {
      validateInsuranceDetailsForBooking((body as { insurance?: unknown }).insurance);
    } catch (validationError) {
      return withB2bGatewayHeaders(
        NextResponse.json(
          {
            error:
              validationError instanceof Error
                ? validationError.message
                : "Invalid insurance payload.",
            requestId: auth.context.requestId,
          },
          { status: 400 }
        ),
        auth.context
      );
    }

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

    try {
      validateTransferFlightDetailsForBooking(payload.transferSelection);
    } catch (validationError) {
      return withB2bGatewayHeaders(
        NextResponse.json(
          {
            error:
              validationError instanceof Error
                ? validationError.message
                : "Invalid transfer flight details.",
            requestId: auth.context.requestId,
          },
          { status: 400 }
        ),
        auth.context
      );
    }

    const hasInsuranceScope =
      auth.context.scopes.includes("*") || auth.context.scopes.includes("insurance:quote");
    if (payload.insurance && !hasInsuranceScope) {
      return withB2bGatewayHeaders(
        NextResponse.json(
          {
            error: "Scope is not allowed for insurance policy issuance",
            requestId: auth.context.requestId,
          },
          { status: 403 }
        ),
        auth.context
      );
    }

    const result = await bookWithOptions(payload, {
      environment: auth.context.aoryxEnvironment,
    });
    const obfuscatedResult = obfuscateBookingResult(result);
    const emptyServices: B2bServicesBookingResult = {
      transfer: { status: "skipped", referenceId: null, message: null },
      excursions: { status: "skipped", referenceId: null, message: null, items: 0 },
      insurance: { status: "skipped", referenceId: null, message: null, provider: null, policies: null },
    };

    let services: B2bServicesBookingResult = emptyServices;
    try {
      services = await processB2bBookingServices({
        requestId: auth.context.requestId,
        clientId: auth.context.clientId,
        payload,
        booking: result,
      });
    } catch (serviceError) {
      const message =
        serviceError instanceof Error && serviceError.message.trim().length > 0
          ? serviceError.message
          : "Failed to record local service bookings";
      console.error("[B2B][book] Local service processing failed", serviceError);
      services = {
        transfer: payload.transferSelection
          ? { status: "failed", referenceId: null, message }
          : emptyServices.transfer,
        excursions:
          payload.excursions?.selections && payload.excursions.selections.length > 0
            ? { status: "failed", referenceId: null, message, items: payload.excursions.selections.length }
            : emptyServices.excursions,
        insurance: payload.insurance
          ? {
              status: "failed",
              referenceId: null,
              message,
              provider: payload.insurance.provider ?? null,
              policies: null,
            }
          : emptyServices.insurance,
      };
    }

    return withB2bGatewayHeaders(
      NextResponse.json({
        requestId: auth.context.requestId,
        data: {
          ...obfuscatedResult,
          services,
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
          error: "Failed to complete booking",
          requestId: auth.context.requestId,
        },
        { status: 500 }
      ),
      auth.context
    );
  }
}
