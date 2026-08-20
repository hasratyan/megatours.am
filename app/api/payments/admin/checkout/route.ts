import { NextRequest, NextResponse } from "next/server";
import { ObjectId, type Document } from "mongodb";
import { getServerSession } from "@/lib/auth-compat/server";
import { authOptions } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin";
import { AoryxClientError, AoryxServiceError, book, bookingDetails } from "@/lib/aoryx-client";
import {
  createEfesPoliciesFromBooking,
  EfesPolicyIssuanceError,
} from "@/lib/efes-client";
import { parseBookingPayload, validatePrebookState } from "@/lib/aoryx-booking";
import { clearPrebookCookie, getPrebookState, getSessionFromCookie } from "@/app/api/aoryx/_shared";
import { isBookingModificationClosed } from "@/lib/booking-modification";
import { resolveBookingStatusKey } from "@/lib/booking-status";
import {
  calculateBookingAddonAmountAmd,
  isBookingCanceled,
  isBookingConfirmed,
  mergeBookingAddonPayload,
  parseBookingAddonCheckoutRequest,
  resolveExistingBookingAddonServiceKeys,
  type BookingAddonCheckoutRequest,
  type BookingAddonServiceKey,
} from "@/lib/booking-addons";
import { issueBookingAddonInsurance } from "@/lib/booking-addon-insurance-issuance";
import { resolveBookingAddonPaymentServiceOutcome } from "@/lib/booking-addon-payment-outcome";
import {
  validateInsuranceDetailsForBooking,
  validateTransferFlightDetailsForBooking,
} from "@/lib/b2b-service-booking";
import { getDb } from "@/lib/db";
import { recordUserBooking } from "@/lib/user-data";
import { sendBookingConfirmationEmail } from "@/lib/email";
import { DEFAULT_SERVICE_FLAGS } from "@/lib/package-builder-state";
import { getServiceFlags } from "@/lib/service-flags";
import type { AoryxBookingPayload, AoryxBookingResult } from "@/types/aoryx";

export const runtime = "nodejs";

const resolveString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const parseSessionId = (input: unknown): string | undefined => {
  const trimmed = resolveString(input);
  return trimmed.length > 0 ? trimmed : undefined;
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

type UserBookingRecord = {
  _id: ObjectId;
  payload?: AoryxBookingPayload | null;
  booking?: AoryxBookingResult | null;
};

const resolveAddonServiceFlag = (service: BookingAddonServiceKey) => {
  if (service === "transfer") return "transfer" as const;
  if (service === "excursion") return "excursion" as const;
  if (service === "flight") return "flight" as const;
  return "insurance" as const;
};

const resolveAddonPayloadPath = (service: BookingAddonServiceKey) => {
  if (service === "transfer") return "payload.transferSelection";
  if (service === "excursion") return "payload.excursions";
  if (service === "flight") return "payload.airTickets";
  return "payload.insurance";
};

const handleAdminAddonCheckout = async (
  userId: string,
  addonRequest: BookingAddonCheckoutRequest
) => {
  const db = await getDb();
  const userBookings = db.collection("user_bookings");
  const userBooking = (await userBookings.findOne({
    userIdString: userId,
    "payload.customerRefNumber": addonRequest.bookingId,
  })) as UserBookingRecord | null;

  if (!userBooking?.payload) {
    return NextResponse.json({ error: "Booking not found." }, { status: 404 });
  }
  if (!isBookingConfirmed(userBooking.booking ?? null)) {
    return NextResponse.json(
      { error: "This booking is not confirmed yet.", code: "booking_not_confirmed" },
      { status: 409 }
    );
  }
  if (isBookingCanceled(userBooking.booking ?? null)) {
    return NextResponse.json(
      {
        error: "Canceled bookings can not receive additional services.",
        code: "booking_canceled",
      },
      { status: 409 }
    );
  }
  if (isBookingModificationClosed(userBooking.payload.checkOutDate)) {
    return NextResponse.json(
      {
        error: "This booking can no longer be modified because the hotel stay has already ended.",
        code: "booking_modification_closed",
      },
      { status: 409 }
    );
  }

  try {
    validateTransferFlightDetailsForBooking(addonRequest.services.transferSelection);
  } catch (validationError) {
    return NextResponse.json(
      {
        error:
          validationError instanceof Error
            ? validationError.message
            : "Transfer flight details are invalid.",
        code: "transfer_details_required",
      },
      { status: 400 }
    );
  }

  try {
    validateInsuranceDetailsForBooking(addonRequest.services.insurance);
  } catch (validationError) {
    return NextResponse.json(
      {
        error:
          validationError instanceof Error
            ? validationError.message
            : "Insurance details are invalid.",
        code: "insurance_details_required",
      },
      { status: 400 }
    );
  }

  const existingServiceKeys = new Set(
    resolveExistingBookingAddonServiceKeys(userBooking.payload)
  );
  const duplicateServices = addonRequest.serviceKeys.filter((service) =>
    existingServiceKeys.has(service)
  );
  if (duplicateServices.length > 0) {
    return NextResponse.json(
      {
        error: "Selected services are already attached to this booking.",
        code: "addon_service_exists",
        services: duplicateServices,
      },
      { status: 409 }
    );
  }

  const serviceFlags = await getServiceFlags().catch(() => DEFAULT_SERVICE_FLAGS);
  const disabledServices = addonRequest.serviceKeys.filter(
    (service) => serviceFlags[resolveAddonServiceFlag(service)] === false
  );
  if (disabledServices.length > 0) {
    return NextResponse.json(
      {
        error: "One or more selected services are currently disabled.",
        code: "service_disabled",
        services: disabledServices,
      },
      { status: 403 }
    );
  }

  let amountValue: number | null = null;
  try {
    const totals = await calculateBookingAddonAmountAmd(
      addonRequest.services,
      userBooking.payload.currency ?? "USD"
    );
    const roundedAmount = Math.round(totals.totalAmd);
    amountValue = Number.isFinite(roundedAmount) && roundedAmount > 0 ? roundedAmount : null;
  } catch (error) {
    console.warn("[AdminCheckout][addons] Failed to calculate audit amount", {
      bookingId: addonRequest.bookingId,
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }

  const merged = mergeBookingAddonPayload(userBooking.payload, addonRequest.services);
  const appliedAt = new Date();
  const updateFilter: Document = {
    _id: userBooking._id,
    userIdString: userId,
  };
  addonRequest.serviceKeys.forEach((service) => {
    updateFilter[resolveAddonPayloadPath(service)] = null;
  });

  const setFields: Document = {
    updatedAt: appliedAt,
    addonLastPayment: {
      at: appliedAt,
      provider: "admin",
      amountValue,
      currency: "AMD",
      requestedServices: addonRequest.serviceKeys,
      appliedServices: merged.appliedServiceKeys,
      skippedServices: merged.skippedServiceKeys,
    },
  };
  if (addonRequest.services.transferSelection) {
    setFields["payload.transferSelection"] = addonRequest.services.transferSelection;
  }
  if (addonRequest.services.excursions) {
    setFields["payload.excursions"] = addonRequest.services.excursions;
  }
  if (addonRequest.services.insurance) {
    setFields["payload.insurance"] = addonRequest.services.insurance;
    setFields.insurancePolicies = [];
    setFields.insuranceError = "Insurance policy issuance has not completed.";
    setFields.insuranceUpdatedAt = appliedAt;
  }
  if (addonRequest.services.airTickets) {
    setFields["payload.airTickets"] = addonRequest.services.airTickets;
  }

  const applyResult = await userBookings.updateOne(updateFilter, { $set: setFields });
  if (applyResult.matchedCount !== 1) {
    return NextResponse.json(
      {
        error: "One or more selected services were already attached to this booking.",
        code: "addon_service_exists",
        services: addonRequest.serviceKeys,
      },
      { status: 409 }
    );
  }

  const insuranceOutcome = await issueBookingAddonInsurance({
    userBookings,
    bookingFilter: { _id: userBooking._id, userIdString: userId },
    payload: merged.payload,
    shouldIssue: merged.appliedServiceKeys.includes("insurance"),
    logContext: {
      flow: "admin_checkout",
      bookingId: addonRequest.bookingId,
      userId,
    },
  });
  const insuranceStatus = insuranceOutcome.status;
  const serviceOutcome = resolveBookingAddonPaymentServiceOutcome({
    appliedServices: merged.appliedServiceKeys,
    insuranceStatus,
  });

  console.info("[AdminCheckout][addons] Services applied", {
    bookingId: addonRequest.bookingId,
    userId,
    requestedServices: addonRequest.serviceKeys,
    appliedServices: serviceOutcome.appliedServices,
    failedServices: serviceOutcome.failedServices,
    insuranceStatus,
  });

  return NextResponse.json({
    bookingId: addonRequest.bookingId,
    appliedServices: serviceOutcome.appliedServices,
    failedServices: serviceOutcome.failedServices,
    skippedServices: merged.skippedServiceKeys,
    insuranceStatus,
  });
};

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Please sign in to continue." }, { status: 401 });
  }
  if (!isAdminUser({ id: session.user.id, email: session.user.email })) {
    return NextResponse.json({ error: "Admin checkout is not allowed." }, { status: 403 });
  }

  try {
    const body = await request.json();
    const flow = resolveString((body as { flow?: unknown }).flow).toLowerCase();
    if (flow === "booking_addons") {
      const addonRequest = parseBookingAddonCheckoutRequest(body);
      if (!addonRequest) {
        return NextResponse.json(
          { error: "Select at least one valid add-on service." },
          { status: 400 }
        );
      }
      return await handleAdminAddonCheckout(session.user.id, addonRequest);
    }

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
      insurancePolicies =
        error instanceof EfesPolicyIssuanceError ? error.policyResults : [];
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
          insurancePolicies,
          insuranceError,
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
