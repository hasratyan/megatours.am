import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { ObjectId } from "mongodb";
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

export async function POST(request: NextRequest) {
  const formData = await request.formData();

  const billNo = readField(formData, "EDP_BILL_NO");
  const recAccount = readField(formData, "EDP_REC_ACCOUNT");
  const amountRaw = readField(formData, "EDP_AMOUNT");
  const precheckFlag = readField(formData, "EDP_PRECHECK");

  if (!billNo || !recAccount || !amountRaw) {
    return textResponse("Missing payment details", 400);
  }

  const amountParsed = parseAmount(amountRaw);
  if (amountParsed === null) {
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
  const record = (await collection.findOne({ billNo })) as IdramPaymentRecord | null;

  if (!record) {
    return textResponse("Unknown bill", 400);
  }

  if (record.recAccount && record.recAccount !== recAccount) {
    return textResponse("Account mismatch", 400);
  }

  const normalizedAmount = formatAmount(amountParsed);
  const amountMatches =
    (typeof record.amount?.formatted === "string" && record.amount.formatted === normalizedAmount) ||
    (typeof record.amount?.value === "number" && Math.abs(record.amount.value - amountParsed) < 0.01);

  if (!amountMatches) {
    return textResponse("Amount mismatch", 400);
  }

  if (precheckFlag.toUpperCase() === "YES") {
    try {
      await collection.updateOne(
        { billNo },
        {
          $set: {
            status: record.status === "created" ? "prechecked" : record.status ?? "prechecked",
            precheckAt: new Date(),
            updatedAt: new Date(),
          },
        }
      );
    } catch (error) {
      console.error("[Idram][result] Failed to store precheck", error);
    }
    return textResponse("OK", 200);
  }

  const payerAccount = readField(formData, "EDP_PAYER_ACCOUNT");
  const transId = readField(formData, "EDP_TRANS_ID");
  const transDate = readField(formData, "EDP_TRANS_DATE");
  const checksum = readField(formData, "EDP_CHECKSUM");

  if (!payerAccount || !transId || !transDate || !checksum) {
    return textResponse("Missing confirmation details", 400);
  }

  const secretKey = typeof process.env.IDRAM_SECRET_KEY === "string"
    ? process.env.IDRAM_SECRET_KEY.trim()
    : "";
  if (!secretKey) {
    console.error("[Idram][result] Missing IDRAM_SECRET_KEY");
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
    return textResponse("Checksum mismatch", 400);
  }

  if (record.status === "booking_complete") {
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
    return textResponse("OK", 200);
  }

  const now = new Date();
  const lock = await collection.findOneAndUpdate(
    { billNo, status: { $nin: ["booking_complete", "booking_failed", "booking_in_progress"] } },
    {
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
      },
    },
    { returnDocument: "after" }
  );

  const lockedRecord = unwrapFindOneAndUpdateResult<IdramPaymentRecord>(lock);
  if (!lockedRecord) {
    return textResponse("OK", 200);
  }

  const payload = lockedRecord.payload as AoryxBookingPayload | undefined;
  if (!payload) {
    await collection.updateOne(
      { billNo },
      {
        $set: {
          status: "booking_failed",
          bookingError: "Missing booking payload",
          updatedAt: new Date(),
        },
      }
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
        {
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
          },
        }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to apply booking add-ons";
      await collection.updateOne(
        { billNo },
        {
          $set: {
            status: "booking_failed",
            bookingError: message,
            updatedAt: new Date(),
          },
        }
      );
      console.error("[Idram][result] Add-on booking update failed", error);
    }
    return textResponse("OK", 200);
  }

  try {
    const result: AoryxBookingResult = await bookWithRecovery(payload, { billNo });
    await collection.updateOne(
      { billNo },
      {
        $set: {
          status: "booking_complete",
          bookingResult: result,
          updatedAt: new Date(),
        },
      }
    );

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
      console.info("[EFES][idram-result] policy response", {
        billNo,
        flow: paymentFlow || "booking",
        policies,
      });
      if (policies.length > 0) {
        await collection.updateOne(
          { billNo },
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
      insurancePolicies = [];
      insuranceError = message;
      await collection.updateOne(
        { billNo },
        {
          $set: {
            insuranceError: message,
            insuranceUpdatedAt: new Date(),
          },
        }
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
    await collection.updateOne(
      { billNo },
      {
        $set: {
          status: "booking_failed",
          bookingError: message,
          updatedAt: new Date(),
        },
      }
    );
    console.error("[Idram][result] Booking failed", error);
  }

  return textResponse("OK", 200);
}
