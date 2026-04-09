import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { ObjectId, type Collection, type Document } from "mongodb";
import { getDb } from "@/lib/db";
import { AoryxClientError, book, bookingDetails } from "@/lib/aoryx-client";
import { createEfesPoliciesFromBooking } from "@/lib/efes-client";
import { recordUserBooking, type AppliedBookingCoupon } from "@/lib/user-data";
import { sendBookingConfirmationEmail } from "@/lib/email";
import { incrementCouponSuccessfulOrders } from "@/lib/coupons";
import { resolveBookingStatusKey } from "@/lib/booking-status";
import {
  mergeBookingAddonPayload,
  parseBookingAddonServices,
  resolveBookingAddonServiceKeys,
} from "@/lib/booking-addons";
import type { AoryxBookingPayload, AoryxBookingResult } from "@/types/aoryx";

export const runtime = "nodejs";

type IdramPaymentRecord = {
  flow?: string | null;
  billNo: string;
  status?: string;
  recAccount?: string;
  amount?: {
    value?: number;
    formatted?: string;
    currency?: string;
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
  addon?: {
    targetBookingId?: string | null;
    customerRefNumber?: string | null;
    serviceKeys?: unknown;
    services?: unknown;
  } | null;
};

const textResponse = (message: string, status = 200) =>
  new NextResponse(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });

const readField = (formData: FormData, key: string) => {
  const raw = formData.get(key);
  return typeof raw === "string" ? raw.trim() : "";
};

const parseAmount = (value: string): number | null => {
  if (!value) return null;
  const normalized = value.replace(/,/g, ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const formatAmount = (value: number) => value.toFixed(2);
const resolveString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const summarizeEfesInsurance = (payload: AoryxBookingPayload | undefined) => {
  const insurance = payload?.insurance;
  return {
    hasInsurance: Boolean(insurance),
    provider: insurance?.provider ?? null,
    travelersCount: Array.isArray(insurance?.travelers) ? insurance.travelers.length : 0,
    startDate: insurance?.startDate ?? payload?.checkInDate ?? null,
    endDate: insurance?.endDate ?? payload?.checkOutDate ?? null,
    territoryCode: insurance?.territoryCode ?? null,
    riskAmount: insurance?.riskAmount ?? null,
    riskCurrency: insurance?.riskCurrency ?? null,
  };
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
    const isBookEndpoint = endpoint === "book";
    if (!isBookEndpoint) return false;
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

const bookWithRecovery = async (
  payload: AoryxBookingPayload,
  context: { billNo: string }
): Promise<AoryxBookingResult> => {
  try {
    return await book(payload);
  } catch (error) {
    if (!shouldAttemptBookReconciliation(error)) {
      throw error;
    }

    console.warn("[Idram][result] Aoryx book failed, attempting BookingDetails recovery", {
      billNo: context.billNo,
      sessionId: payload.sessionId,
      message: error instanceof Error ? error.message : "Unknown error",
    });

    try {
      const recovered = await bookingDetails(payload.sessionId);
      if (isBookingResultConfirmed(recovered)) {
        console.info("[Idram][result] BookingDetails recovery confirmed booking", {
          billNo: context.billNo,
          sessionId: payload.sessionId,
          status: recovered.status,
          hotelConfirmationNumber: recovered.hotelConfirmationNumber,
          supplierConfirmationNumber: recovered.supplierConfirmationNumber,
          adsConfirmationNumber: recovered.adsConfirmationNumber,
        });
        return recovered;
      }
    } catch (recoveryError) {
      console.error("[Idram][result] BookingDetails recovery failed", {
        billNo: context.billNo,
        sessionId: payload.sessionId,
        message: recoveryError instanceof Error ? recoveryError.message : "Unknown error",
      });
    }

    throw error;
  }
};

const checksumFor = (parts: string[]) =>
  createHash("md5").update(parts.join(":"), "utf8").digest("hex");

const resolveCouponCode = (
  record: Pick<IdramPaymentRecord, "coupon">
): string | null => {
  const code = typeof record.coupon?.code === "string" ? record.coupon.code.trim().toUpperCase() : "";
  return code.length > 0 ? code : null;
};

const resolveAppliedCoupon = (
  record: Pick<IdramPaymentRecord, "coupon">
): AppliedBookingCoupon | null => {
  const code = resolveCouponCode(record);
  const discountPercent =
    typeof record.coupon?.discountPercent === "number" && Number.isFinite(record.coupon.discountPercent)
      ? Math.min(100, Math.max(0, record.coupon.discountPercent))
      : null;
  if (!code || discountPercent === null || discountPercent <= 0) return null;
  return {
    code,
    discountPercent,
    discountAmount:
      typeof record.coupon?.discountAmount === "number" && Number.isFinite(record.coupon.discountAmount)
        ? record.coupon.discountAmount
        : null,
    discountedAmount:
      typeof record.coupon?.discountedAmount === "number" &&
      Number.isFinite(record.coupon.discountedAmount)
        ? record.coupon.discountedAmount
        : null,
  };
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

const buildDiagnosticEvent = (
  stage: string,
  level: "info" | "warn" | "error",
  reason: string,
  details: Record<string, unknown> = {}
) => ({
  at: new Date(),
  stage,
  level,
  reason,
  details,
});

export async function POST(request: NextRequest) {
  const formData = await request.formData();

  const billNo = readField(formData, "EDP_BILL_NO");
  const recAccount = readField(formData, "EDP_REC_ACCOUNT");
  const amountRaw = readField(formData, "EDP_AMOUNT");
  const precheckFlag = readField(formData, "EDP_PRECHECK");
  const callbackRequestDetails = {
    method: request.method,
    path: request.nextUrl.pathname,
    contentType: resolveString(request.headers.get("content-type")) || null,
    clientIp: resolveString(request.headers.get("x-forwarded-for")).split(",")[0]?.trim() || null,
    userAgent: resolveString(request.headers.get("user-agent")) || null,
    billNo: billNo || null,
    recAccount: recAccount || null,
    amountRaw: amountRaw || null,
    precheckFlag: precheckFlag || null,
  };

  console.info("[Idram][result] Callback received", callbackRequestDetails);

  if (!billNo || !recAccount || !amountRaw) {
    console.warn("[Idram][result] Missing payment details", callbackRequestDetails);
    return textResponse("Missing payment details", 400);
  }

  const amountParsed = parseAmount(amountRaw);
  if (amountParsed === null) {
    console.warn("[Idram][result] Invalid payment amount", callbackRequestDetails);
    return textResponse("Invalid payment amount", 400);
  }

  let db: Awaited<ReturnType<typeof getDb>>;
  try {
    db = await getDb();
  } catch (error) {
    console.error("[Idram][result] Failed to connect to database", error);
    return textResponse("Payment lookup failed", 500);
  }

  const collection = db.collection("idram_payments");
  const paymentCollection = collection as Collection<Document>;
  const appendDiagnosticEvent = async (
    stage: string,
    level: "info" | "warn" | "error",
    reason: string,
    details: Record<string, unknown> = {},
    extraSet: Record<string, unknown> = {}
  ) => {
    const event = buildDiagnosticEvent(stage, level, reason, details);
    try {
      await paymentCollection.updateOne(
        { billNo },
        {
          $push: {
            "diagnostics.events": {
              $each: [event],
              $slice: -50,
            },
          },
          $set: {
            "diagnostics.lastEvent": event,
            "diagnostics.updatedAt": new Date(),
            ...extraSet,
          },
        } as Document
      );
    } catch (error) {
      console.error("[Idram][result] Failed to persist diagnostic event", {
        billNo,
        stage,
        reason,
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };
  const record = (await collection.findOne({ billNo })) as IdramPaymentRecord | null;

  if (!record) {
    console.warn("[Idram][result] Unknown bill", callbackRequestDetails);
    return textResponse("Unknown bill", 400);
  }

  if (record.recAccount && record.recAccount !== recAccount) {
    console.warn("[Idram][result] Account mismatch", {
      billNo,
      expectedRecAccount: record.recAccount,
      receivedRecAccount: recAccount,
    });
    await appendDiagnosticEvent(
      "callback",
      "error",
      "account_mismatch",
      {
        expectedRecAccount: record.recAccount ?? null,
        receivedRecAccount: recAccount,
      },
      {
        "diagnostics.lastCallback": {
          at: new Date(),
          phase: "validation",
          ...callbackRequestDetails,
          validationError: "account_mismatch",
        },
      }
    );
    return textResponse("Account mismatch", 400);
  }

  const normalizedAmount = formatAmount(amountParsed);
  const amountMatches =
    (typeof record.amount?.formatted === "string" && record.amount.formatted === normalizedAmount) ||
    (typeof record.amount?.value === "number" && Math.abs(record.amount.value - amountParsed) < 0.01);

  if (!amountMatches) {
    console.warn("[Idram][result] Amount mismatch", {
      billNo,
      expectedAmountFormatted: record.amount?.formatted ?? null,
      expectedAmountValue: record.amount?.value ?? null,
      receivedAmount: amountRaw,
      normalizedAmount,
    });
    await appendDiagnosticEvent(
      "callback",
      "error",
      "amount_mismatch",
      {
        expectedAmountFormatted: record.amount?.formatted ?? null,
        expectedAmountValue: record.amount?.value ?? null,
        receivedAmount: amountRaw,
        normalizedAmount,
      },
      {
        "diagnostics.lastCallback": {
          at: new Date(),
          phase: "validation",
          ...callbackRequestDetails,
          normalizedAmount,
          validationError: "amount_mismatch",
        },
      }
    );
    return textResponse("Amount mismatch", 400);
  }

  if (precheckFlag.toUpperCase() === "YES") {
    try {
      const precheckAt = new Date();
      const precheckEvent = buildDiagnosticEvent("callback", "info", "precheck_received", {
        recordStatus: record.status ?? null,
        normalizedAmount,
      });
      await collection.updateOne(
        { billNo },
        ({
          $set: {
            status: record.status === "created" ? "prechecked" : record.status ?? "prechecked",
            precheckAt,
            updatedAt: precheckAt,
            "diagnostics.lastEvent": precheckEvent,
            "diagnostics.lastCallback": {
              at: precheckAt,
              phase: "precheck",
              ...callbackRequestDetails,
              normalizedAmount,
            },
            "diagnostics.updatedAt": precheckAt,
          },
          $push: {
            "diagnostics.events": {
              $each: [precheckEvent],
              $slice: -50,
            },
          },
        }) as Document
      );
      console.info("[Idram][result] Stored precheck", {
        billNo,
        previousStatus: record.status ?? null,
      });
    } catch (error) {
      console.error("[Idram][result] Failed to store precheck", error);
    }
    return textResponse("OK", 200);
  }

  const payerAccount = readField(formData, "EDP_PAYER_ACCOUNT");
  const transId = readField(formData, "EDP_TRANS_ID");
  const transDate = readField(formData, "EDP_TRANS_DATE");
  const checksum = readField(formData, "EDP_CHECKSUM");
  const confirmationDetails = {
    ...callbackRequestDetails,
    payerAccount: payerAccount || null,
    transId: transId || null,
    transDate: transDate || null,
  };

  if (!payerAccount || !transId || !transDate || !checksum) {
    console.warn("[Idram][result] Missing confirmation details", confirmationDetails);
    await appendDiagnosticEvent(
      "callback",
      "error",
      "missing_confirmation_details",
      confirmationDetails,
      {
        "diagnostics.lastCallback": {
          at: new Date(),
          phase: "payment_confirmation",
          ...confirmationDetails,
          validationError: "missing_confirmation_details",
        },
      }
    );
    return textResponse("Missing confirmation details", 400);
  }

  const secretKey = typeof process.env.IDRAM_SECRET_KEY === "string"
    ? process.env.IDRAM_SECRET_KEY.trim()
    : "";
  if (!secretKey) {
    console.error("[Idram][result] Missing IDRAM_SECRET_KEY");
    await appendDiagnosticEvent("integration", "error", "missing_idram_secret_key", confirmationDetails);
    return textResponse("Missing secret key", 500);
  }

  const expectedChecksum = checksumFor([
    recAccount,
    amountRaw,
    secretKey,
    billNo,
    payerAccount,
    transId,
    transDate,
  ]);

  if (expectedChecksum.toLowerCase() !== checksum.toLowerCase()) {
    console.warn("[Idram][result] Checksum mismatch", {
      billNo,
      expectedChecksum,
      receivedChecksum: checksum,
      transId,
      transDate,
    });
    await appendDiagnosticEvent(
      "callback",
      "error",
      "checksum_mismatch",
      {
        payerAccount,
        transId,
        transDate,
      },
      {
        "diagnostics.lastCallback": {
          at: new Date(),
          phase: "payment_confirmation",
          ...confirmationDetails,
          validationError: "checksum_mismatch",
        },
      }
    );
    return textResponse("Checksum mismatch", 400);
  }

  if (record.status === "booking_complete") {
    await appendDiagnosticEvent("callback", "info", "callback_ignored_booking_already_complete", {
      recordStatus: record.status ?? null,
      payerAccount,
      transId,
      transDate,
    });
    const couponCode = resolveCouponCode(record);
    if (couponCode && record.couponOrderCounted !== true) {
      try {
        const markResult = await collection.updateOne(
          { billNo, couponOrderCounted: { $ne: true } },
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
              { billNo },
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
        console.error("[Idram][result] Failed to update coupon order stats", error);
      }
    }
    return textResponse("OK", 200);
  }

  if (record.status === "booking_failed") {
    await appendDiagnosticEvent("callback", "info", "callback_ignored_booking_already_failed", {
      recordStatus: record.status ?? null,
      payerAccount,
      transId,
      transDate,
    });
    return textResponse("OK", 200);
  }

  const now = new Date();
  const paymentConfirmationEvent = buildDiagnosticEvent(
    "callback",
    "info",
    "payment_confirmation_received",
    {
      payerAccount,
      transId,
      transDate,
      amountRaw,
      normalizedAmount,
      recordStatus: record.status ?? null,
    }
  );
  const lock = await collection.findOneAndUpdate(
    { billNo, status: { $nin: ["booking_complete", "booking_failed", "booking_in_progress"] } },
    ({
      $set: {
        status: "booking_in_progress",
        paidAt: now,
        updatedAt: now,
        idram: {
          payerAccount,
          transId,
          transDate,
          checksum,
          amount: amountRaw,
        },
        "diagnostics.lastEvent": paymentConfirmationEvent,
        "diagnostics.lastCallback": {
          at: now,
          phase: "payment_confirmation",
          ...confirmationDetails,
          normalizedAmount,
        },
        "diagnostics.updatedAt": now,
      },
      $push: {
        "diagnostics.events": {
          $each: [paymentConfirmationEvent],
          $slice: -50,
        },
      },
    }) as Document,
    { returnDocument: "after" }
  );

  const lockedRecord = unwrapFindOneAndUpdateResult<IdramPaymentRecord>(lock);
  if (!lockedRecord) {
    await appendDiagnosticEvent("callback", "info", "callback_ignored_lock_not_acquired", {
      payerAccount,
      transId,
      transDate,
    });
    return textResponse("OK", 200);
  }

  console.info("[Idram][result] Payment record locked", {
    billNo,
    flow: lockedRecord.flow ?? "booking",
    recordStatus: lockedRecord.status ?? null,
  });

  const payload = lockedRecord.payload as AoryxBookingPayload | undefined;
  if (!payload) {
    const missingPayloadAt = new Date();
    await collection.updateOne(
      { billNo },
      ({
        $set: {
          status: "booking_failed",
          bookingError: "Missing booking payload",
          updatedAt: missingPayloadAt,
          "diagnostics.lastApplicationError": {
            at: missingPayloadAt,
            phase: "booking",
            flow: lockedRecord.flow ?? "booking",
            reason: "missing_booking_payload",
            message: "Missing booking payload",
          },
          "diagnostics.updatedAt": missingPayloadAt,
        },
        $push: {
          "diagnostics.events": {
            $each: [
              buildDiagnosticEvent("application", "error", "missing_booking_payload", {
                flow: lockedRecord.flow ?? "booking",
              }),
            ],
            $slice: -50,
          },
        },
      }) as Document
    );
    return textResponse("OK", 200);
  }

  const paymentFlow = resolveString(lockedRecord.flow).toLowerCase();
  if (paymentFlow === "booking_addons") {
    try {
      const targetBookingId = resolveString(lockedRecord.addon?.targetBookingId);
      if (!targetBookingId || !ObjectId.isValid(targetBookingId)) {
        throw new Error("Missing add-on booking reference.");
      }
      const userId = resolveString(lockedRecord.userId);
      if (!userId) {
        throw new Error("Missing add-on booking owner.");
      }
      const addonServices = parseBookingAddonServices(lockedRecord.addon?.services ?? null);
      const requestedServiceKeys = resolveBookingAddonServiceKeys(addonServices);
      if (requestedServiceKeys.length === 0) {
        throw new Error("Missing add-on services payload.");
      }

      const bookingObjectId = new ObjectId(targetBookingId);
      const userBookings = db.collection("user_bookings");
      const userBooking = (await userBookings.findOne({
        _id: bookingObjectId,
        userIdString: userId,
      })) as { payload?: AoryxBookingPayload | null; booking?: AoryxBookingResult | null } | null;
      if (!userBooking?.payload) {
        throw new Error("Target booking not found.");
      }

      const merged = mergeBookingAddonPayload(userBooking.payload, addonServices);
      const appliedAt = new Date();
      await userBookings.updateOne(
        { _id: bookingObjectId, userIdString: userId },
        {
          $set: {
            payload: merged.payload,
            updatedAt: appliedAt,
            addonLastPayment: {
              at: appliedAt,
              provider: "idram",
              billNo,
              amountValue:
                typeof lockedRecord.amount?.value === "number" &&
                Number.isFinite(lockedRecord.amount.value)
                  ? lockedRecord.amount.value
                  : null,
              currency: lockedRecord.amount?.currency ?? null,
              requestedServices: requestedServiceKeys,
              appliedServices: merged.appliedServiceKeys,
              skippedServices: merged.skippedServiceKeys,
            },
          },
        }
      );

      await collection.updateOne(
        { billNo },
        ({
          $set: {
            status: "booking_complete",
            payload: merged.payload,
            bookingResult: userBooking.booking ?? null,
            addonAppliedAt: appliedAt,
            addonApply: {
              targetBookingId,
              requestedServices: requestedServiceKeys,
              appliedServices: merged.appliedServiceKeys,
              skippedServices: merged.skippedServiceKeys,
            },
            updatedAt: appliedAt,
            "diagnostics.lastApplicationResult": {
              at: appliedAt,
              phase: "addon_apply",
              flow: "booking_addons",
              targetBookingId,
              requestedServices: requestedServiceKeys,
              appliedServices: merged.appliedServiceKeys,
              skippedServices: merged.skippedServiceKeys,
            },
            "diagnostics.updatedAt": appliedAt,
          },
          $push: {
            "diagnostics.events": {
              $each: [
                buildDiagnosticEvent("application", "info", "addon_booking_applied", {
                  targetBookingId,
                  requestedServices: requestedServiceKeys,
                  appliedServices: merged.appliedServiceKeys,
                  skippedServices: merged.skippedServiceKeys,
                }),
              ],
              $slice: -50,
            },
          },
        }) as Document
      );
      console.info("[Idram][result] Add-on booking update completed", {
        billNo,
        targetBookingId,
        requestedServices: requestedServiceKeys,
        appliedServices: merged.appliedServiceKeys,
        skippedServices: merged.skippedServiceKeys,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to apply booking add-ons";
      const failedAt = new Date();
      await collection.updateOne(
        { billNo },
        ({
          $set: {
            status: "booking_failed",
            bookingError: message,
            updatedAt: failedAt,
            "diagnostics.lastApplicationError": {
              at: failedAt,
              phase: "addon_apply",
              flow: "booking_addons",
              message,
            },
            "diagnostics.updatedAt": failedAt,
          },
          $push: {
            "diagnostics.events": {
              $each: [
                buildDiagnosticEvent("application", "error", "addon_booking_update_failed", {
                  message,
                }),
              ],
              $slice: -50,
            },
          },
        }) as Document
      );
      console.error("[Idram][result] Add-on booking update failed", error);
    }
    return textResponse("OK", 200);
  }

  try {
    const result: AoryxBookingResult = await bookWithRecovery(payload, { billNo });
    const completedAt = new Date();
    await collection.updateOne(
      { billNo },
      ({
        $set: {
          status: "booking_complete",
          bookingResult: result,
          updatedAt: completedAt,
          "diagnostics.lastApplicationResult": {
            at: completedAt,
            phase: "booking",
            flow: paymentFlow || "booking",
            status: result.status ?? null,
            customerRefNumber: result.customerRefNumber ?? payload.customerRefNumber ?? null,
            hotelConfirmationNumber: result.hotelConfirmationNumber ?? null,
            supplierConfirmationNumber: result.supplierConfirmationNumber ?? null,
            adsConfirmationNumber: result.adsConfirmationNumber ?? null,
          },
          "diagnostics.updatedAt": completedAt,
        },
        $push: {
          "diagnostics.events": {
            $each: [
              buildDiagnosticEvent("application", "info", "booking_completed", {
                flow: paymentFlow || "booking",
                status: result.status ?? null,
                customerRefNumber: result.customerRefNumber ?? payload.customerRefNumber ?? null,
                hotelConfirmationNumber: result.hotelConfirmationNumber ?? null,
                supplierConfirmationNumber: result.supplierConfirmationNumber ?? null,
                adsConfirmationNumber: result.adsConfirmationNumber ?? null,
              }),
            ],
            $slice: -50,
          },
        },
      }) as Document
    );

    console.info("[Idram][result] Booking completed", {
      billNo,
      flow: paymentFlow || "booking",
      status: result.status ?? null,
      customerRefNumber: result.customerRefNumber ?? payload.customerRefNumber ?? null,
    });

    const couponCode = resolveCouponCode(lockedRecord);
    if (couponCode) {
      try {
        const markResult = await collection.updateOne(
          { billNo, couponOrderCounted: { $ne: true } },
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
              { billNo },
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
        console.error("[Idram][result] Failed to update coupon order stats", error);
      }
    }

    let insurancePolicies: unknown[] | null = null;
    let insuranceError: string | null = null;
    try {
      console.info("[EFES][idram-result] policy request", {
        billNo,
        flow: paymentFlow || "booking",
        ...summarizeEfesInsurance(payload),
      });
      const policies = await createEfesPoliciesFromBooking(payload);
      insurancePolicies = policies;
      const insuranceUpdatedAt = new Date();
      console.info("[EFES][idram-result] policy response", {
        billNo,
        flow: paymentFlow || "booking",
        policies,
      });
      await collection.updateOne(
        { billNo },
        ({
          $set: {
            insurancePolicies: policies,
            insuranceUpdatedAt,
            "diagnostics.lastInsuranceResult": {
              at: insuranceUpdatedAt,
              flow: paymentFlow || "booking",
              policyCount: policies.length,
              provider: payload.insurance?.provider ?? null,
            },
            "diagnostics.updatedAt": insuranceUpdatedAt,
          },
          $push: {
            "diagnostics.events": {
              $each: [
                buildDiagnosticEvent("insurance", "info", "efes_policies_created", {
                  flow: paymentFlow || "booking",
                  policyCount: policies.length,
                  provider: payload.insurance?.provider ?? null,
                }),
              ],
              $slice: -50,
            },
          },
        }) as Document
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create EFES policies";
      insurancePolicies = [];
      insuranceError = message;
      const insuranceUpdatedAt = new Date();
      await collection.updateOne(
        { billNo },
        ({
          $set: {
            insuranceError: message,
            insuranceUpdatedAt,
            "diagnostics.lastInsuranceError": {
              at: insuranceUpdatedAt,
              flow: paymentFlow || "booking",
              provider: payload.insurance?.provider ?? null,
              message,
            },
            "diagnostics.updatedAt": insuranceUpdatedAt,
          },
          $push: {
            "diagnostics.events": {
              $each: [
                buildDiagnosticEvent("insurance", "error", "efes_policy_creation_failed", {
                  flow: paymentFlow || "booking",
                  provider: payload.insurance?.provider ?? null,
                  message,
                }),
              ],
              $slice: -50,
            },
          },
        }) as Document
      );
      console.error("[Idram][result] EFES policy creation failed", error);
    }

    if (lockedRecord.userId) {
      try {
        const appliedCoupon = resolveAppliedCoupon(lockedRecord);
        await recordUserBooking({
          userId: lockedRecord.userId,
          payload,
          result,
          source: "aoryx-idram",
          coupon: appliedCoupon,
          insurancePolicies,
          insuranceError,
        });
      } catch (error) {
        console.error("[Idram][result] Failed to record user booking", error);
      }
    }

    if (lockedRecord.userEmail) {
      const appliedCoupon = resolveAppliedCoupon(lockedRecord);
      await sendBookingConfirmationEmail({
        to: lockedRecord.userEmail,
        name: lockedRecord.userName ?? null,
        payload,
        result,
        locale: lockedRecord.locale ?? null,
        paidAmount: lockedRecord.amount?.value ?? null,
        paidCurrency: lockedRecord.amount?.currency ?? null,
        coupon: appliedCoupon,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to complete booking";
    const failedAt = new Date();
    await collection.updateOne(
      { billNo },
      ({
        $set: {
          status: "booking_failed",
          bookingError: message,
          updatedAt: failedAt,
          "diagnostics.lastApplicationError": {
            at: failedAt,
            phase: "booking",
            flow: paymentFlow || "booking",
            message,
            endpoint: error instanceof AoryxClientError ? error.endpoint ?? null : null,
            statusCode: error instanceof AoryxClientError ? error.statusCode ?? null : null,
          },
          "diagnostics.updatedAt": failedAt,
        },
        $push: {
          "diagnostics.events": {
            $each: [
              buildDiagnosticEvent("application", "error", "booking_failed", {
                flow: paymentFlow || "booking",
                message,
                endpoint: error instanceof AoryxClientError ? error.endpoint ?? null : null,
                statusCode: error instanceof AoryxClientError ? error.statusCode ?? null : null,
              }),
            ],
            $slice: -50,
          },
        },
      }) as Document
    );
    console.error("[Idram][result] Booking failed", error);
  }

  return textResponse("OK", 200);
}
