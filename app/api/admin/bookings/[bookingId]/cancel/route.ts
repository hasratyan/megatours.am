import { NextRequest, NextResponse } from "next/server";
import { ObjectId, type Collection, type Document } from "mongodb";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin";
import { getDb } from "@/lib/db";
import { AORYX_API_KEY, AORYX_BASE_URL, AORYX_CUSTOMER_CODE, AORYX_DEFAULT_CURRENCY, AORYX_TIMEOUT_MS } from "@/lib/env";
import { getAmdRates } from "@/lib/pricing";
import { convertToAmd } from "@/lib/currency";
import { refundVposPayment, type PaymentProvider } from "@/lib/vpos-refund";
import type { AoryxBookingPayload, AoryxBookingResult } from "@/types/aoryx";

export const runtime = "nodejs";

type CancelRouteParams = {
  bookingId: string;
};

type UserBookingRecord = {
  _id: ObjectId;
  source?: string | null;
  payload?: AoryxBookingPayload | null;
  booking?: AoryxBookingResult | null;
  userIdString?: string | null;
  userEmail?: string | null;
  userName?: string | null;
  createdAt?: Date | string | null;
};

type VposPaymentRecord = {
  _id?: ObjectId;
  provider?: PaymentProvider | string;
  orderId?: string;
  orderNumber?: string;
  status?: string;
  locale?: string | null;
  amount?: {
    value?: number;
    minor?: number;
    currencyCode?: string;
    decimals?: number;
    breakdownAmd?: {
      insurance?: number;
    } | null;
  };
  payload?: AoryxBookingPayload | null;
  bookingResult?: AoryxBookingResult | Record<string, unknown> | null;
  gatewayResponse?: Record<string, unknown> | null;
  refundStatus?: string | null;
  updatedAt?: Date | string | number | null;
  createdAt?: Date | string | number | null;
};

type RefundabilityResult = {
  isRefundable: boolean;
  source: "cancellation_policy" | "booking_details";
  rooms: Array<{
    roomIdentifier: number | null;
    rateType: string | null;
    refundable: boolean | null;
    policyAvailable: boolean | null;
  }>;
};

const resolveString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const toNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const toBoolean = (value: unknown): boolean | null => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "y", "1"].includes(normalized)) return true;
    if (["false", "no", "n", "0"].includes(normalized)) return false;
  }
  return null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeArray = <T,>(value: T | T[] | null | undefined): T[] => {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
};

const readField = (record: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    if (record[key] != null) {
      return record[key];
    }
  }
  return undefined;
};

const resolveProviderFromSource = (source: string | null | undefined): PaymentProvider | null => {
  const normalized = (source ?? "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.includes("ameria")) return "ameriabank";
  if (normalized.includes("idbank")) return "idbank";
  return null;
};

const normalizeCurrencyCode = (value: unknown) => {
  if (value == null) return "";
  const raw = typeof value === "number" ? String(Math.trunc(value)) : String(value);
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const upper = trimmed.toUpperCase();
  if (upper === "AMD") return "051";
  if (upper === "USD") return "840";
  if (upper === "EUR") return "978";
  if (upper === "RUB") return "643";
  if (/^\d+$/.test(trimmed)) return trimmed.padStart(3, "0");
  return trimmed;
};

const normalizeRateTypeRefundability = (rateType: string | null): boolean | null => {
  if (!rateType) return null;
  const normalized = rateType.trim().toLowerCase();
  if (!normalized) return null;
  if (/non[\s_-]*refund/.test(normalized) || /no\s+refund/.test(normalized)) {
    return false;
  }
  if (/refundable/.test(normalized) || /\brefund\b/.test(normalized)) {
    return true;
  }
  return null;
};

const normalizeRoomNodes = (raw: unknown): Record<string, unknown>[] =>
  normalizeArray(raw)
    .filter(isRecord);

const readRoomItemsFromNode = (rawRoomsNode: unknown): Record<string, unknown>[] => {
  if (Array.isArray(rawRoomsNode)) {
    return rawRoomsNode.filter(isRecord);
  }
  if (isRecord(rawRoomsNode)) {
    return normalizeRoomNodes(readField(rawRoomsNode, ["Room", "room"]));
  }
  return [];
};

const evaluateRoomsRefundability = (rooms: Record<string, unknown>[]) => {
  const normalizedRooms = rooms.map((room) => {
    const refundableValue = toBoolean(
      readField(room, ["Refundable", "IsRefundable", "refundable", "isRefundable"])
    );
    const nonRefundableValue = toBoolean(
      readField(room, ["NonRefundable", "nonRefundable"])
    );
    const rateType = resolveString(
      readField(room, ["RateType", "RateCategory", "rateType", "ContractType", "contractType"])
    ) || null;
    const byRateType = normalizeRateTypeRefundability(rateType);
    const policyAvailable = toBoolean(
      readField(room, [
        "IsCancelationPolicyAvailble",
        "IsCancellationPolicyAvailable",
        "isCancelationPolicyAvailble",
        "isCancellationPolicyAvailable",
      ])
    );
    const roomIdentifierNumber = toNumber(readField(room, ["RoomIdentifier", "roomIdentifier"]));
    const roomIdentifier =
      roomIdentifierNumber !== null && Number.isFinite(roomIdentifierNumber)
        ? Math.round(roomIdentifierNumber)
        : null;

    const refundable =
      refundableValue !== null
        ? refundableValue
        : nonRefundableValue !== null
          ? !nonRefundableValue
          : byRateType !== null
            ? byRateType
            : policyAvailable;

    return {
      roomIdentifier,
      rateType,
      refundable,
      policyAvailable,
    };
  });

  const known = normalizedRooms.filter((room) => room.refundable !== null);
  const isRefundable =
    known.length > 0 && normalizedRooms.length > 0 && normalizedRooms.every((room) => room.refundable === true);

  return {
    isRefundable,
    rooms: normalizedRooms,
  };
};

const buildRoomIdentifiers = (
  userBooking: UserBookingRecord,
  fallbackRooms: Array<{ roomIdentifier: number | null }>
) => {
  const fromBooking = normalizeArray(userBooking.booking?.rooms)
    .map((room) => toNumber(room.roomIdentifier))
    .filter((value): value is number => value !== null && value > 0)
    .map((value) => Math.round(value));

  const fromPayload = normalizeArray(userBooking.payload?.rooms)
    .map((room) => toNumber(room.roomIdentifier))
    .filter((value): value is number => value !== null && value > 0)
    .map((value) => Math.round(value));

  const fromFallback = fallbackRooms
    .map((room) => room.roomIdentifier)
    .filter((value): value is number => typeof value === "number" && value > 0)
    .map((value) => Math.round(value));

  const unique = Array.from(new Set([...fromBooking, ...fromPayload, ...fromFallback]));
  if (unique.length > 0) return unique;

  const payloadRoomCount = userBooking.payload?.rooms.length ?? 0;
  if (payloadRoomCount > 0) {
    return Array.from({ length: payloadRoomCount }, (_, index) => index + 1);
  }

  return [];
};

const ensureAoryxConfig = () => {
  if (!AORYX_BASE_URL || !AORYX_API_KEY) {
    throw new Error("Aoryx API is not configured.");
  }
};

const requestAoryx = async (
  endpoint: "CancellationPolicy" | "Cancel" | "BookingDetails",
  payload: Record<string, unknown>
) => {
  ensureAoryxConfig();
  const url = `${AORYX_BASE_URL.replace(/\/+$/, "")}/${endpoint}`;
  const timeoutMs = Number.isFinite(AORYX_TIMEOUT_MS) && AORYX_TIMEOUT_MS > 0 ? AORYX_TIMEOUT_MS : 15000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ApiKey: AORYX_API_KEY,
        ...(AORYX_CUSTOMER_CODE ? { CustomerCode: AORYX_CUSTOMER_CODE } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok || !data) {
      const dataRecord: Record<string, unknown> = data && isRecord(data) ? data : {};
      const errorInfo = isRecord(dataRecord.ErrorInfo) ? dataRecord.ErrorInfo : null;
      const message = resolveString(dataRecord.ExceptionMessage) || resolveString(errorInfo?.Description) || "Aoryx request failed.";
      throw new Error(message);
    }

    const errorInfo = isRecord(data.ErrorInfo) ? data.ErrorInfo : null;
    const errorDescription = resolveString(errorInfo?.Description);
    if (errorDescription) {
      throw new Error(errorDescription);
    }

    const exceptionMessage = resolveString(data.ExceptionMessage);
    const isSuccessValue = readField(data, ["IsSuccess", "isSuccess"]);
    const isSuccess = toBoolean(isSuccessValue);
    if (isSuccess === false && exceptionMessage) {
      throw new Error(exceptionMessage);
    }

    return data;
  } finally {
    clearTimeout(timeout);
  }
};

const getRefundabilityFromCancellationPolicy = async (
  payload: AoryxBookingPayload
): Promise<RefundabilityResult> => {
  const rateKeys = payload.rooms
    .map((room) => resolveString(room.rateKey))
    .filter((rateKey) => rateKey.length > 0);
  if (rateKeys.length === 0) {
    throw new Error("Missing rate keys for refundable check.");
  }

  const requestPayload = {
    SessionId: payload.sessionId,
    SearchParameter: {
      HotelCode: payload.hotelCode,
      GroupCode: payload.groupCode,
      Currency: resolveString(payload.currency) || AORYX_DEFAULT_CURRENCY || "USD",
      RateKeys: {
        RateKey: rateKeys,
      },
    },
  };
  const response = await requestAoryx("CancellationPolicy", requestPayload);
  const roomsContainer = readField(response, ["Rooms", "rooms"]);
  const roomItems = readRoomItemsFromNode(roomsContainer);
  const evaluated = evaluateRoomsRefundability(roomItems);
  return {
    isRefundable: evaluated.isRefundable,
    source: "cancellation_policy",
    rooms: evaluated.rooms,
  };
};

const getRefundabilityFromBookingDetails = async (
  payload: AoryxBookingPayload
): Promise<RefundabilityResult> => {
  const response = await requestAoryx("BookingDetails", { SessionId: payload.sessionId });
  const genericBookingInfo = isRecord(readField(response, ["GenericBookingInfo", "genericBookingInfo"]))
    ? (readField(response, ["GenericBookingInfo", "genericBookingInfo"]) as Record<string, unknown>)
    : null;
  const bookingResponse = genericBookingInfo && isRecord(readField(genericBookingInfo, ["HotelBookingResponse", "hotelBookingResponse"]))
    ? (readField(genericBookingInfo, ["HotelBookingResponse", "hotelBookingResponse"]) as Record<string, unknown>)
    : null;
  const roomsContainer = bookingResponse ? readField(bookingResponse, ["Rooms", "rooms"]) : null;
  const roomItems = readRoomItemsFromNode(roomsContainer);
  const evaluated = evaluateRoomsRefundability(roomItems);
  return {
    isRefundable: evaluated.isRefundable,
    source: "booking_details",
    rooms: evaluated.rooms,
  };
};

const toDate = (value: unknown): Date | null => {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }
  return null;
};

const isAlreadyRefunded = (payment: VposPaymentRecord) => {
  const refundStatus = resolveString(payment.refundStatus).toLowerCase();
  if (refundStatus === "refunded" || refundStatus === "already_refunded") {
    return true;
  }

  const gateway = isRecord(payment.gatewayResponse) ? payment.gatewayResponse : null;
  if (!gateway) return false;

  const paymentState = resolveString(readField(gateway, ["PaymentState", "paymentState"])).toLowerCase();
  if (paymentState === "payment_refunded") return true;

  const orderStatus = toNumber(readField(gateway, ["OrderStatus", "orderStatus"]));
  if (orderStatus === 4) return true;

  const refundedAmount = toNumber(readField(gateway, ["RefundedAmount", "refundedAmount"]));
  if (refundedAmount !== null && refundedAmount > 0) return true;

  const paymentAmountInfo = isRecord(readField(gateway, ["paymentAmountInfo", "PaymentAmountInfo"]))
    ? (readField(gateway, ["paymentAmountInfo", "PaymentAmountInfo"]) as Record<string, unknown>)
    : null;
  const refundedAmountInfo = toNumber(readField(paymentAmountInfo ?? {}, ["refundedAmount", "RefundedAmount"]));
  return refundedAmountInfo !== null && refundedAmountInfo > 0;
};

const findPaymentForBooking = async (
  paymentCollection: Collection<Document>,
  booking: UserBookingRecord
) => {
  const providerHint = resolveProviderFromSource(booking.source);
  const customerRefNumber =
    resolveString(booking.booking?.customerRefNumber) ||
    resolveString(booking.payload?.customerRefNumber);
  const adsConfirmationNumber = resolveString(booking.booking?.adsConfirmationNumber);
  const supplierConfirmationNumber = resolveString(booking.booking?.supplierConfirmationNumber);

  const orFilters: Record<string, unknown>[] = [];
  if (customerRefNumber) {
    orFilters.push({ "payload.customerRefNumber": customerRefNumber });
    orFilters.push({ "bookingResult.customerRefNumber": customerRefNumber });
    orFilters.push({ orderNumber: customerRefNumber });
  }
  if (adsConfirmationNumber) {
    orFilters.push({ "bookingResult.adsConfirmationNumber": adsConfirmationNumber });
  }
  if (supplierConfirmationNumber) {
    orFilters.push({ "bookingResult.supplierConfirmationNumber": supplierConfirmationNumber });
  }

  if (orFilters.length === 0) return null;

  const providerFilter = providerHint ? providerHint : { $in: ["idbank", "ameriabank"] };
  return paymentCollection.findOne(
    {
      provider: providerFilter,
      status: { $in: ["booking_complete", "booking_in_progress", "payment_success"] },
      $or: orFilters,
    },
    {
      sort: {
        updatedAt: -1,
        createdAt: -1,
      },
    }
  ) as Promise<VposPaymentRecord | null>;
};

const calculateInsuranceExclusionMinor = async (
  payment: VposPaymentRecord,
  payload: AoryxBookingPayload | null | undefined,
  decimals: number
) => {
  const recordedInsuranceAmd = toNumber(payment.amount?.breakdownAmd?.insurance);
  if (recordedInsuranceAmd !== null && recordedInsuranceAmd > 0) {
    return Math.round(recordedInsuranceAmd * Math.pow(10, decimals));
  }

  const insuranceAmount = toNumber(payload?.insurance?.price);
  if (insuranceAmount === null || insuranceAmount <= 0) {
    return 0;
  }

  const insuranceCurrency =
    resolveString(payload?.insurance?.currency) ||
    resolveString(payload?.currency) ||
    "USD";
  const rates = await getAmdRates();
  const insuranceInAmd = convertToAmd(insuranceAmount, insuranceCurrency, rates);
  if (insuranceInAmd === null) {
    throw new Error(`Missing exchange rate for insurance currency ${insuranceCurrency}.`);
  }
  return Math.round(insuranceInAmd * Math.pow(10, decimals));
};

const toMinor = (value: number | null | undefined, decimals: number): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(value * Math.pow(10, decimals));
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<CancelRouteParams> }
) {
  void request;

  try {
    const session = await getServerSession(authOptions);
    const adminUser = {
      id: session?.user?.id ?? null,
      email: session?.user?.email ?? null,
    };
    const isAdmin = isAdminUser(adminUser);
    if (!isAdmin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { bookingId } = await params;
    const normalizedBookingId = bookingId?.trim();
    if (!normalizedBookingId || !ObjectId.isValid(normalizedBookingId)) {
      return NextResponse.json({ error: "Invalid booking id." }, { status: 400 });
    }
    const bookingObjectId = new ObjectId(normalizedBookingId);

    const db = await getDb();
    const userBookings = db.collection("user_bookings");
    const vposPayments = db.collection("vpos_payments");

    const userBooking = (await userBookings.findOne({ _id: bookingObjectId })) as UserBookingRecord | null;
    if (!userBooking) {
      return NextResponse.json({ error: "Booking not found." }, { status: 404 });
    }

    const payload = userBooking.payload ?? null;
    if (!payload) {
      return NextResponse.json({ error: "Booking payload is missing." }, { status: 422 });
    }

    const bookingResult = userBooking.booking ?? null;
    const bookingStatus = resolveString(bookingResult?.status).toLowerCase();
    if (bookingStatus === "4" || bookingStatus.includes("cancel")) {
      return NextResponse.json({ error: "Booking is already canceled.", code: "already_canceled" }, { status: 409 });
    }
    const source = resolveString(userBooking.source).toLowerCase();
    if (!source.includes("vpos")) {
      return NextResponse.json(
        {
          error: "Cancellation refund is available only for VPOS bookings.",
          code: "unsupported_booking_source",
        },
        { status: 409 }
      );
    }

    const paymentRecord = await findPaymentForBooking(vposPayments, userBooking);
    if (!paymentRecord) {
      return NextResponse.json(
        { error: "No corresponding VPOS payment was found for this booking.", code: "vpos_payment_not_found" },
        { status: 404 }
      );
    }

    const provider = resolveString(paymentRecord.provider).toLowerCase() as PaymentProvider;
    if (provider !== "idbank" && provider !== "ameriabank") {
      return NextResponse.json(
        { error: "Only IDBank and Ameriabank VPOS refunds are supported.", code: "unsupported_provider" },
        { status: 409 }
      );
    }
    if (!paymentRecord._id) {
      return NextResponse.json({ error: "Payment record id is missing." }, { status: 422 });
    }

    const refundabilityChecks: RefundabilityResult[] = [];
    let refundability: RefundabilityResult | null = null;
    try {
      refundability = await getRefundabilityFromCancellationPolicy(payload);
      refundabilityChecks.push(refundability);
    } catch (error) {
      console.warn("[Admin][booking-cancel] CancellationPolicy refundable check failed", error);
    }

    if (!refundability || !refundability.isRefundable) {
      try {
        const detailsCheck = await getRefundabilityFromBookingDetails(payload);
        refundabilityChecks.push(detailsCheck);
        if (!refundability || detailsCheck.isRefundable) {
          refundability = detailsCheck;
        }
      } catch (error) {
        console.warn("[Admin][booking-cancel] BookingDetails refundable check failed", error);
      }
    }

    if (!refundability || !refundability.isRefundable) {
      return NextResponse.json(
        {
          error: "This booking is not refundable according to Aoryx cancellation policy.",
          code: "not_refundable",
          refundableChecks: refundabilityChecks,
        },
        { status: 409 }
      );
    }

    const roomIdentifiers = buildRoomIdentifiers(userBooking, refundability.rooms);
    if (roomIdentifiers.length === 0) {
      return NextResponse.json(
        { error: "Unable to resolve room identifiers for cancellation.", code: "missing_room_identifiers" },
        { status: 422 }
      );
    }

    const adsConfirmationNumber = resolveString(bookingResult?.adsConfirmationNumber);
    if (!adsConfirmationNumber) {
      return NextResponse.json(
        { error: "Missing ADS confirmation number required for cancellation.", code: "missing_ads_confirmation" },
        { status: 422 }
      );
    }

    const cancelRequestPayload = {
      SessionId: payload.sessionId,
      Currency: resolveString(payload.currency) || AORYX_DEFAULT_CURRENCY || "USD",
      ADSConfirmationNumber: adsConfirmationNumber,
      CancelRooms: {
        CancelRoom: roomIdentifiers.map((roomIdentifier) => ({
          RoomIdentifier: roomIdentifier,
        })),
      },
    };
    const cancelResponse = await requestAoryx("Cancel", cancelRequestPayload);
    const cancelStatusRaw = readField(cancelResponse, ["Status", "status"]);
    const cancelStatusString = resolveString(cancelStatusRaw);
    const cancelStatusCode = toNumber(cancelStatusRaw);
    const isCancelSuccess =
      cancelStatusCode === 4 ||
      cancelStatusString === "4" ||
      cancelStatusString.toLowerCase().includes("cancel");

    if (!isCancelSuccess) {
      return NextResponse.json(
        {
          error: "Aoryx cancellation failed.",
          code: "aoryx_cancel_failed",
          cancelStatus: cancelStatusRaw ?? null,
        },
        { status: 502 }
      );
    }

    const decimals =
      typeof paymentRecord.amount?.decimals === "number" && Number.isFinite(paymentRecord.amount.decimals)
        ? Math.max(0, Math.trunc(paymentRecord.amount.decimals))
        : 2;
    const paidMinor =
      typeof paymentRecord.amount?.minor === "number" && Number.isFinite(paymentRecord.amount.minor)
        ? Math.round(paymentRecord.amount.minor)
        : toMinor(paymentRecord.amount?.value ?? null, decimals);

    if (paidMinor === null || paidMinor <= 0) {
      return NextResponse.json({ error: "Invalid paid amount in payment record." }, { status: 422 });
    }

    const insuranceExclusionMinor = await calculateInsuranceExclusionMinor(paymentRecord, payload, decimals);
    const refundAmountMinor = Math.max(0, paidMinor - insuranceExclusionMinor);
    if (refundAmountMinor <= 0) {
      return NextResponse.json(
        {
          error: "Refund amount is zero after excluding insurance.",
          code: "zero_refund_amount",
        },
        { status: 409 }
      );
    }

    const now = new Date();
    const alreadyRefunded = isAlreadyRefunded(paymentRecord);
    const orderId = resolveString(paymentRecord.orderId);
    if (!orderId) {
      return NextResponse.json({ error: "Missing payment order id." }, { status: 422 });
    }

    const refundSummaryBase = {
      provider,
      amountMinor: refundAmountMinor,
      amountValue: Number((refundAmountMinor / Math.pow(10, decimals)).toFixed(decimals)),
      currencyCode: normalizeCurrencyCode(paymentRecord.amount?.currencyCode ?? "051"),
      insuranceExcludedMinor: insuranceExclusionMinor,
      requestedAt: now,
      requestedBy: {
        id: adminUser.id,
        email: adminUser.email,
      },
    };

    let refundResponse: {
      responseCode: string | null;
      responseMessage: string | null;
      raw: Record<string, unknown> | null;
      skipped: boolean;
    };

    if (alreadyRefunded) {
      refundResponse = {
        responseCode: null,
        responseMessage: "Payment is already refunded.",
        raw: null,
        skipped: true,
      };
    } else {
      const refundLock = await vposPayments.findOneAndUpdate(
        {
          _id: paymentRecord._id,
          refundStatus: {
            $nin: ["refund_in_progress", "refunded", "already_refunded"],
          },
        },
        {
          $set: {
            refundStatus: "refund_in_progress",
            refundRequestedAt: now,
            updatedAt: now,
          },
        },
        { returnDocument: "after" }
      );
      if (!refundLock) {
        const latest = (await vposPayments.findOne({ _id: paymentRecord._id })) as VposPaymentRecord | null;
        if (latest && isAlreadyRefunded(latest)) {
          refundResponse = {
            responseCode: null,
            responseMessage: "Payment is already refunded.",
            raw: null,
            skipped: true,
          };
        } else {
          return NextResponse.json(
            {
              error: "Refund is already in progress for this payment.",
              code: "refund_in_progress",
              bookingStatus: cancelStatusString || "4",
            },
            { status: 409 }
          );
        }
      } else {
        try {
          const result = await refundVposPayment({
            provider,
            orderId,
            amountMinor: refundAmountMinor,
            decimals,
            currencyCode: normalizeCurrencyCode(paymentRecord.amount?.currencyCode ?? "051"),
            language: paymentRecord.locale ?? null,
          });
          refundResponse = {
            responseCode: result.responseCode,
            responseMessage: result.responseMessage,
            raw: result.raw,
            skipped: false,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : "Refund request failed.";
          await vposPayments.updateOne(
            { _id: paymentRecord._id },
            {
              $set: {
                cancellation: {
                  at: now,
                  by: {
                    id: adminUser.id,
                    email: adminUser.email,
                  },
                  cancelStatus: cancelStatusString || "4",
                  roomIdentifiers,
                  aoryxResponse: cancelResponse,
                  refundableCheck: refundability,
                },
                refundStatus: "failed",
                refundError: message,
                refundAttempt: refundSummaryBase,
                updatedAt: now,
              },
            }
          );
          await userBookings.updateOne(
            { _id: bookingObjectId },
            {
              $set: {
                "booking.status": cancelStatusString || "4",
                cancellation: {
                  at: now,
                  by: {
                    id: adminUser.id,
                    email: adminUser.email,
                  },
                  refundableCheck: refundability,
                  refund: {
                    ...refundSummaryBase,
                    status: "failed",
                    error: message,
                  },
                },
                updatedAt: now,
              },
            }
          );
          return NextResponse.json(
            {
              error: `Booking canceled, but refund failed: ${message}`,
              code: "refund_failed",
              bookingStatus: cancelStatusString || "4",
            },
            { status: 502 }
          );
        }
      }
    }

    await vposPayments.updateOne(
      { _id: paymentRecord._id },
      {
        $set: {
          cancellation: {
            at: now,
            by: {
              id: adminUser.id,
              email: adminUser.email,
            },
            cancelStatus: cancelStatusString || "4",
            roomIdentifiers,
            aoryxResponse: cancelResponse,
            refundableCheck: refundability,
          },
          refundStatus: refundResponse.skipped ? "already_refunded" : "refunded",
          refund: {
            ...refundSummaryBase,
            ...refundResponse,
          },
          refundedAt: refundResponse.skipped ? toDate(paymentRecord.updatedAt) ?? now : now,
          updatedAt: now,
        },
      }
    );

    await userBookings.updateOne(
      { _id: bookingObjectId },
      {
        $set: {
          "booking.status": cancelStatusString || "4",
          cancellation: {
            at: now,
            by: {
              id: adminUser.id,
              email: adminUser.email,
            },
            refundableCheck: refundability,
            refund: {
              ...refundSummaryBase,
              status: refundResponse.skipped ? "already_refunded" : "refunded",
              responseCode: refundResponse.responseCode,
              responseMessage: refundResponse.responseMessage,
            },
          },
          updatedAt: now,
        },
      }
    );

    return NextResponse.json({
      message: refundResponse.skipped
        ? "Booking canceled. Payment was already refunded."
        : "Booking canceled and refund requested successfully.",
      bookingStatus: cancelStatusString || "4",
      refund: {
        ...refundSummaryBase,
        status: refundResponse.skipped ? "already_refunded" : "refunded",
        responseCode: refundResponse.responseCode,
        responseMessage: refundResponse.responseMessage,
      },
    });
  } catch (error) {
    console.error("[Admin][booking-cancel] Failed to cancel and refund booking", error);
    const message = error instanceof Error ? error.message : "Failed to cancel booking.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
