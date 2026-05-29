import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth-compat/server";
import { authOptions } from "@/lib/auth";
import { AoryxClientError, AoryxServiceError, book, bookingDetails } from "@/lib/aoryx-client";
import { createEfesPoliciesFromBooking } from "@/lib/efes-client";
import { parseBookingPayload, validatePrebookState } from "@/lib/aoryx-booking";
import { clearPrebookCookie, getPrebookState, getSessionFromCookie } from "@/app/api/aoryx/_shared";
import { resolveBookingStatusKey } from "@/lib/booking-status";
import { recordUserBooking } from "@/lib/user-data";
import { sendBookingConfirmationEmail } from "@/lib/email";
import type { AoryxBookingPayload, AoryxBookingResult } from "@/types/aoryx";

export const runtime = "nodejs";

const ADMIN_CHECKOUT_EMAIL = "support@megatours.am";

const resolveString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const parseSessionId = (input: unknown): string | undefined => {
  const trimmed = resolveString(input);
  return trimmed.length > 0 ? trimmed : undefined;
};

const isAdminCheckoutUser = (email: string | null | undefined) =>
  email?.trim().toLowerCase() === ADMIN_CHECKOUT_EMAIL;

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
    if (endpoint !== "book") return false;
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

const bookWithRecovery = async (payload: AoryxBookingPayload): Promise<AoryxBookingResult> => {
  try {
    return await book(payload);
  } catch (error) {
    if (!shouldAttemptBookReconciliation(error)) {
      throw error;
    }

    console.warn("[AdminCheckout] Aoryx book failed, attempting BookingDetails recovery", {
      sessionId: payload.sessionId,
      customerRefNumber: payload.customerRefNumber ?? null,
      message: error instanceof Error ? error.message : "Unknown error",
    });

    try {
      const recovered = await bookingDetails(payload.sessionId);
      if (isBookingResultConfirmed(recovered)) {
        console.info("[AdminCheckout] BookingDetails recovery confirmed booking", {
          sessionId: payload.sessionId,
          customerRefNumber: payload.customerRefNumber ?? null,
          status: recovered.status,
          hotelConfirmationNumber: recovered.hotelConfirmationNumber,
          supplierConfirmationNumber: recovered.supplierConfirmationNumber,
          adsConfirmationNumber: recovered.adsConfirmationNumber,
        });
        return recovered;
      }
    } catch (recoveryError) {
      console.error("[AdminCheckout] BookingDetails recovery failed", {
        sessionId: payload.sessionId,
        customerRefNumber: payload.customerRefNumber ?? null,
        message: recoveryError instanceof Error ? recoveryError.message : "Unknown error",
      });
    }

    throw error;
  }
};

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Please sign in to continue." }, { status: 401 });
  }
  if (!isAdminCheckoutUser(session.user.email)) {
    return NextResponse.json({ error: "Admin checkout is not allowed." }, { status: 403 });
  }

  try {
    const body = await request.json();
    const locale =
      typeof (body as { locale?: unknown }).locale === "string"
        ? (body as { locale?: string }).locale?.trim() ?? null
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

    const result = await bookWithRecovery(payload);
    let insurancePolicies: unknown[] | null = null;
    let insuranceError: string | null = null;

    try {
      insurancePolicies = await createEfesPoliciesFromBooking(payload);
    } catch (error) {
      insurancePolicies = [];
      insuranceError =
        error instanceof Error ? error.message : "Failed to create EFES policies";
      console.error("[AdminCheckout] EFES policy creation failed", error);
    }

    try {
      await recordUserBooking({
        userId: session.user.id,
        payload,
        result,
        source: "aoryx-admin",
        insurancePolicies,
        insuranceError,
      });
    } catch (error) {
      console.error("[AdminCheckout] Failed to record user booking", error);
    }

    if (session.user.email) {
      try {
        await sendBookingConfirmationEmail({
          to: session.user.email,
          name: session.user.name ?? null,
          payload,
          result,
          locale,
        });
      } catch (error) {
        console.error("[AdminCheckout] Failed to send booking confirmation email", error);
      }
    }

    const bookingId =
      resolveString(payload.customerRefNumber) ||
      resolveString(result.customerRefNumber) ||
      resolveString(result.adsConfirmationNumber);
    const response = NextResponse.json({
      bookingId,
      status: result.status ?? null,
    });
    clearPrebookCookie(response);
    return response;
  } catch (error) {
    console.error("[AdminCheckout] Failed to submit booking", error);

    if (error instanceof AoryxServiceError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 400 }
      );
    }

    if (error instanceof AoryxClientError) {
      return NextResponse.json(
        { error: error.message, code: "AORYX_UNAVAILABLE" },
        { status: 502 }
      );
    }

    return NextResponse.json(
      { error: "Failed to submit booking" },
      { status: 500 }
    );
  }
}
