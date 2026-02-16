import { NextRequest, NextResponse } from "next/server";
import { ObjectId, type Collection, type Document } from "mongodb";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin";
import { getDb } from "@/lib/db";
import { AORYX_API_KEY, AORYX_BASE_URL, AORYX_CUSTOMER_CODE, AORYX_DEFAULT_CURRENCY, AORYX_TIMEOUT_MS } from "@/lib/env";
import { getAmdRates } from "@/lib/pricing";
import { convertToAmd } from "@/lib/currency";
import { cancelVposPayment } from "@/lib/vpos-cancel";
import { verifyVposOperationState } from "@/lib/vpos-payment-details";
import { refundVposPayment, type PaymentProvider } from "@/lib/vpos-refund";
import type { AoryxBookingPayload, AoryxBookingResult } from "@/types/aoryx";

export const runtime = "nodejs";

type CancelRouteParams = {
  bookingId: string;
};

type RefundServiceKey = "transfer" | "excursion" | "flight";

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

const getRefundableServiceAmountAmd = (
  payload: AoryxBookingPayload | null | undefined,
  service: RefundServiceKey,
  rates: Awaited<ReturnType<typeof getAmdRates>>
) => {
  if (!payload) return null;

  if (service === "transfer") {
    const amount = toNumber(payload.transferSelection?.totalPrice);
    if (amount === null || amount <= 0) return null;
    const currency = resolveString(payload.transferSelection?.pricing?.currency) || resolveString(payload.currency);
    return convertToAmd(amount, currency, rates);
  }

  if (service === "excursion") {
    const amount = toNumber(payload.excursions?.totalAmount);
    if (amount === null || amount <= 0) return null;
    const currency =
      resolveString(payload.excursions?.selections?.[0]?.currency) || resolveString(payload.currency);
    return convertToAmd(amount, currency, rates);
  }

  const amount = toNumber(payload.airTickets?.price);
  if (amount === null || amount <= 0) return null;
  const currency = resolveString(payload.airTickets?.currency) || resolveString(payload.currency);
  return convertToAmd(amount, currency, rates);
};

const calculateSelectedServicesRefundMinor = async (
  payload: AoryxBookingPayload | null | undefined,
  services: RefundServiceKey[],
  decimals: number
) => {
  if (!payload || services.length === 0) return null;
  const rates = await getAmdRates();
  let totalAmd = 0;

  for (const service of services) {
    const amountAmd = getRefundableServiceAmountAmd(payload, service, rates);
    if (amountAmd === null || amountAmd <= 0) return null;
    totalAmd += amountAmd;
  }

  return Math.round(totalAmd * Math.pow(10, decimals));
};

const toMinor = (value: number | null | undefined, decimals: number): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(value * Math.pow(10, decimals));
};

const ALLOWED_REFUND_SERVICES = new Set<RefundServiceKey>(["transfer", "excursion", "flight"]);

const isCanceledBookingStatus = (value: string | null | undefined) => {
  const normalized = resolveString(value).toLowerCase();
  if (!normalized) return false;
  return normalized === "4" || normalized.includes("cancel");
};

const buildVerificationErrorMessage = (
  operation: "cancel" | "refund",
  reason: string,
  lastError: string | null
) => {
  const operationLabel = operation === "cancel" ? "cancel" : "refund";
  if (lastError) {
    return `Unable to verify payment ${operationLabel} via GetPaymentDetails: ${lastError}`;
  }
  return `Payment ${operationLabel} request was sent, but GetPaymentDetails did not confirm success (reason: ${reason}).`;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<CancelRouteParams> }
) {
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

    const requestBody = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const actionRaw = resolveString(isRecord(requestBody) ? requestBody.action : "").toLowerCase();
    const action: "cancel" | "refund" | "cancel_and_refund" =
      actionRaw === "cancel" ? "cancel" : actionRaw === "refund" ? "refund" : "cancel_and_refund";
    const shouldCancelBooking = action === "cancel" || action === "cancel_and_refund";
    const shouldCancelPayment = action === "cancel";
    const shouldRefundPayment = action === "refund" || action === "cancel_and_refund";

    const refundServicesRaw = isRecord(requestBody) && Array.isArray(requestBody.services) ? requestBody.services : [];
    const normalizedRefundServices = refundServicesRaw
      .map((value) => (typeof value === "string" ? value.trim().toLowerCase() : ""))
      .filter((value): value is RefundServiceKey => ALLOWED_REFUND_SERVICES.has(value as RefundServiceKey));
    if (refundServicesRaw.length > 0 && normalizedRefundServices.length !== refundServicesRaw.length) {
      return NextResponse.json(
        {
          error: "Invalid service selection for partial refund.",
          code: "invalid_refund_services",
        },
        { status: 422 }
      );
    }
    const refundServices = Array.from(new Set(normalizedRefundServices));

    const refundAmountInput = isRecord(requestBody) ? requestBody.refundAmount : undefined;
    const hasRefundAmountInput =
      refundAmountInput != null &&
      !(typeof refundAmountInput === "string" && refundAmountInput.trim().length === 0);
    const requestedRefundAmount = hasRefundAmountInput ? toNumber(refundAmountInput) : null;
    if (shouldRefundPayment && hasRefundAmountInput && (requestedRefundAmount === null || requestedRefundAmount <= 0)) {
      return NextResponse.json(
        {
          error: "Invalid refund amount. Enter a positive number.",
          code: "invalid_refund_amount",
        },
        { status: 422 }
      );
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
    const bookingStatus = resolveString(bookingResult?.status);
    const bookingAlreadyCanceled = isCanceledBookingStatus(bookingStatus);
    if (action === "cancel_and_refund" && bookingAlreadyCanceled) {
      return NextResponse.json({ error: "Booking is already canceled.", code: "already_canceled" }, { status: 409 });
    }
    if (action === "refund" && !bookingAlreadyCanceled && refundServices.length === 0) {
      return NextResponse.json(
        {
          error: "Cancel booking first, or select additional services for partial refund.",
          code: "booking_not_canceled",
        },
        { status: 409 }
      );
    }

    const source = resolveString(userBooking.source).toLowerCase();
    if (!source.includes("vpos")) {
      return NextResponse.json(
        {
          error: "This action is available only for VPOS bookings.",
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
        { error: "Only IDBank and Ameriabank VPOS payments are supported.", code: "unsupported_provider" },
        { status: 409 }
      );
    }
    if (!paymentRecord._id) {
      return NextResponse.json({ error: "Payment record id is missing." }, { status: 422 });
    }

    let refundability: RefundabilityResult | null = null;
    let roomIdentifiers: number[] = [];
    let cancelResponse: Record<string, unknown> | null = null;
    let cancelStatusString = bookingStatus || "4";
    let canceledNow = false;

    const runAoryxCancellationIfNeeded = async () => {
      if (!shouldCancelBooking || bookingAlreadyCanceled || canceledNow) return;

      try {
        refundability = await getRefundabilityFromCancellationPolicy(payload);
      } catch (error) {
        console.warn("[Admin][booking-cancel] CancellationPolicy room lookup failed", error);
      }

      if (!refundability || !refundability.isRefundable) {
        try {
          const detailsCheck = await getRefundabilityFromBookingDetails(payload);
          if (!refundability || detailsCheck.isRefundable) {
            refundability = detailsCheck;
          }
        } catch (error) {
          console.warn("[Admin][booking-cancel] BookingDetails room lookup failed", error);
        }
      }

      roomIdentifiers = buildRoomIdentifiers(userBooking, refundability?.rooms ?? []);
      if (roomIdentifiers.length === 0) {
        throw new Error("Unable to resolve room identifiers for cancellation.");
      }

      const adsConfirmationNumber = resolveString(bookingResult?.adsConfirmationNumber);
      if (!adsConfirmationNumber) {
        throw new Error("Missing ADS confirmation number required for cancellation.");
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
      cancelResponse = await requestAoryx("Cancel", cancelRequestPayload);
      const cancelStatusRaw = readField(cancelResponse, ["Status", "status"]);
      cancelStatusString = resolveString(cancelStatusRaw);
      const cancelStatusCode = toNumber(cancelStatusRaw);
      const isCancelSuccess =
        cancelStatusCode === 4 ||
        cancelStatusString === "4" ||
        cancelStatusString.toLowerCase().includes("cancel");

      if (!isCancelSuccess) {
        throw new Error("Aoryx cancellation failed.");
      }
      canceledNow = true;
    };

    const now = new Date();
    const orderId = resolveString(paymentRecord.orderId);
    if (!orderId) {
      return NextResponse.json({ error: "Missing payment order id." }, { status: 422 });
    }

    const buildCancellationSetBase = (actionAt: Date) => {
      const base: Record<string, unknown> = {};
      if (bookingAlreadyCanceled || canceledNow) {
        base["cancellation.at"] = actionAt;
        base["cancellation.by"] = {
          id: adminUser.id,
          email: adminUser.email,
        };
        base["cancellation.cancelStatus"] = cancelStatusString || "4";
      }
      if (roomIdentifiers.length > 0) {
        base["cancellation.roomIdentifiers"] = roomIdentifiers;
      }
      if (cancelResponse) {
        base["cancellation.aoryxResponse"] = cancelResponse;
      }
      if (refundability) {
        base["cancellation.refundableCheck"] = refundability;
      }
      return base;
    };

    if (shouldCancelPayment) {
      if (isAlreadyRefunded(paymentRecord)) {
        return NextResponse.json(
          {
            error: "Payment is already refunded. Cancel action is no longer available.",
            code: "already_refunded",
            bookingStatus: cancelStatusString || "4",
          },
          { status: 409 }
        );
      }

      let cancelResult:
        | {
            responseCode: string | null;
            responseMessage: string | null;
            raw: Record<string, unknown>;
          }
        | null = null;
      let cancelVerification:
        | {
            verified: boolean;
            reason: string;
            attempts: number;
            lastError: string | null;
            details: {
              orderStatus: number | null;
              paymentState: string | null;
              refundedAmount: number | null;
              raw: Record<string, unknown>;
            } | null;
          }
        | null = null;

      try {
        cancelResult = await cancelVposPayment({
          provider,
          orderId,
          language: paymentRecord.locale ?? null,
        });
        cancelVerification = await verifyVposOperationState({
          operation: "cancel",
          provider,
          orderId,
          language: paymentRecord.locale ?? null,
        });
        if (!cancelVerification.verified) {
          throw new Error(
            buildVerificationErrorMessage("cancel", cancelVerification.reason, cancelVerification.lastError)
          );
        }

        await runAoryxCancellationIfNeeded();
        const cancellationSetBase = buildCancellationSetBase(now);

        await vposPayments.updateOne(
          { _id: paymentRecord._id },
          {
            $set: {
              ...cancellationSetBase,
              "cancellation.payment": {
                action: "cancel",
                status: "canceled",
                responseCode: cancelResult.responseCode,
                responseMessage: cancelResult.responseMessage,
                verification: {
                  reason: cancelVerification.reason,
                  attempts: cancelVerification.attempts,
                  details: cancelVerification.details?.raw ?? null,
                },
              },
              paymentCancelStatus: "canceled",
              paymentCancel: {
                provider,
                requestedAt: now,
                requestedBy: {
                  id: adminUser.id,
                  email: adminUser.email,
                },
                responseCode: cancelResult.responseCode,
                responseMessage: cancelResult.responseMessage,
                raw: cancelResult.raw,
                verification: {
                  reason: cancelVerification.reason,
                  attempts: cancelVerification.attempts,
                  details: cancelVerification.details?.raw ?? null,
                },
              },
              updatedAt: now,
            },
          }
        );
        const userBookingSet: Record<string, unknown> = {
          ...cancellationSetBase,
          "cancellation.payment": {
            action: "cancel",
            status: "canceled",
            responseCode: cancelResult.responseCode,
            responseMessage: cancelResult.responseMessage,
            verification: {
              reason: cancelVerification.reason,
              attempts: cancelVerification.attempts,
              details: cancelVerification.details?.raw ?? null,
            },
          },
          updatedAt: now,
        };
        if (canceledNow || bookingAlreadyCanceled) {
          userBookingSet["booking.status"] = cancelStatusString || "4";
        }
        await userBookings.updateOne({ _id: bookingObjectId }, { $set: userBookingSet });

        return NextResponse.json({
          action: "cancel",
          message: canceledNow
            ? "Payment cancel verified and booking canceled successfully."
            : "Payment cancel verified successfully.",
          bookingStatus: canceledNow || bookingAlreadyCanceled ? cancelStatusString || "4" : bookingStatus || null,
          payment: {
            action: "cancel",
            status: "canceled",
            responseCode: cancelResult.responseCode,
            responseMessage: cancelResult.responseMessage,
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Payment cancel request failed.";
        const cancellationSetBase = buildCancellationSetBase(now);
        const paymentStatus = cancelResult
          ? cancelVerification?.verified
            ? "canceled"
            : "verification_failed"
          : "failed";
        const errorCode = cancelResult
          ? cancelVerification?.verified
            ? "aoryx_cancel_failed_after_payment_cancel"
            : "cancel_verification_failed"
          : "cancel_failed";

        await vposPayments.updateOne(
          { _id: paymentRecord._id },
          {
            $set: {
              ...cancellationSetBase,
              "cancellation.payment": {
                action: "cancel",
                status: paymentStatus,
                error: cancelVerification?.verified ? null : message,
                responseCode: cancelResult?.responseCode ?? null,
                responseMessage: cancelResult?.responseMessage ?? null,
                verification: cancelVerification
                  ? {
                      reason: cancelVerification.reason,
                      attempts: cancelVerification.attempts,
                      details: cancelVerification.details?.raw ?? null,
                    }
                  : null,
              },
              paymentCancelStatus: paymentStatus,
              paymentCancelError: cancelVerification?.verified ? null : message,
              updatedAt: now,
            },
          }
        );
        const userBookingSet: Record<string, unknown> = {
          ...cancellationSetBase,
          "cancellation.payment": {
            action: "cancel",
            status: paymentStatus,
            error: cancelVerification?.verified ? null : message,
            responseCode: cancelResult?.responseCode ?? null,
            responseMessage: cancelResult?.responseMessage ?? null,
            verification: cancelVerification
              ? {
                  reason: cancelVerification.reason,
                  attempts: cancelVerification.attempts,
                  details: cancelVerification.details?.raw ?? null,
                }
              : null,
          },
          updatedAt: now,
        };
        if (canceledNow || bookingAlreadyCanceled) {
          userBookingSet["booking.status"] = cancelStatusString || "4";
        }
        await userBookings.updateOne({ _id: bookingObjectId }, { $set: userBookingSet });

        return NextResponse.json(
          {
            error:
              cancelVerification?.verified && !canceledNow
                ? `Payment cancel verified, but booking cancellation failed: ${message}`
                : message,
            code: errorCode,
            bookingStatus: canceledNow || bookingAlreadyCanceled ? cancelStatusString || "4" : bookingStatus || null,
          },
          { status: 502 }
        );
      }
    }

    if (!shouldRefundPayment) {
      return NextResponse.json(
        {
          error: "Unsupported action.",
          code: "unsupported_action",
        },
        { status: 400 }
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
    const maxRefundMinor = Math.max(0, paidMinor - insuranceExclusionMinor);
    if (maxRefundMinor <= 0) {
      return NextResponse.json(
        {
          error: "Refund amount is zero after excluding insurance.",
          code: "zero_refund_amount",
        },
        { status: 409 }
      );
    }

    const selectedServicesAmountMinor =
      refundServices.length > 0
        ? await calculateSelectedServicesRefundMinor(payload, refundServices, decimals)
        : null;
    if (refundServices.length > 0 && (selectedServicesAmountMinor === null || selectedServicesAmountMinor <= 0)) {
      return NextResponse.json(
        {
          error: "Unable to resolve refund amount from selected services.",
          code: "invalid_selected_services_amount",
        },
        { status: 422 }
      );
    }

    const selectedServicesCapMinor =
      selectedServicesAmountMinor !== null
        ? Math.min(maxRefundMinor, selectedServicesAmountMinor)
        : maxRefundMinor;
    const selectedServicesAreCap =
      selectedServicesAmountMinor !== null && selectedServicesAmountMinor <= maxRefundMinor;
    let refundAmountMinor = selectedServicesCapMinor;
    if (hasRefundAmountInput) {
      const requestedMinor = toMinor(requestedRefundAmount, decimals);
      if (requestedMinor === null || requestedMinor <= 0) {
        return NextResponse.json(
          {
            error: "Invalid refund amount. Enter a positive number.",
            code: "invalid_refund_amount",
          },
          { status: 422 }
        );
      }
      if (requestedMinor > selectedServicesCapMinor) {
        const maxRefundAmount = Number(
          (selectedServicesCapMinor / Math.pow(10, decimals)).toFixed(decimals)
        );
        return NextResponse.json(
          {
            error:
              refundServices.length > 0 && selectedServicesAreCap
                ? "Refund amount exceeds selected services total."
                : "Refund amount exceeds the allowed maximum (insurance is excluded).",
            code:
              refundServices.length > 0 && selectedServicesAreCap
                ? "refund_amount_exceeds_selected_services"
                : "refund_amount_exceeds_max",
            maxRefundAmount,
          },
          { status: 409 }
        );
      }
      refundAmountMinor = requestedMinor;
    }

    const alreadyRefunded = isAlreadyRefunded(paymentRecord);
    const refundSummaryBase = {
      provider,
      amountMinor: refundAmountMinor,
      amountValue: Number((refundAmountMinor / Math.pow(10, decimals)).toFixed(decimals)),
      maxAmountMinor: maxRefundMinor,
      maxAmountValue: Number((maxRefundMinor / Math.pow(10, decimals)).toFixed(decimals)),
      selectedServicesCapMinor,
      selectedServicesCapValue: Number(
        (selectedServicesCapMinor / Math.pow(10, decimals)).toFixed(decimals)
      ),
      currencyCode: normalizeCurrencyCode(paymentRecord.amount?.currencyCode ?? "051"),
      insuranceExcludedMinor: insuranceExclusionMinor,
      services: refundServices,
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
          const cancellationSetBase = buildCancellationSetBase(now);
          await vposPayments.updateOne(
            { _id: paymentRecord._id },
            {
              $set: {
                ...cancellationSetBase,
                refundStatus: "failed",
                refundError: message,
                refundAttempt: refundSummaryBase,
                "cancellation.refund": {
                  ...refundSummaryBase,
                  status: "failed",
                  error: message,
                },
                updatedAt: now,
              },
            }
          );
          await userBookings.updateOne(
            { _id: bookingObjectId },
            {
              $set: {
                ...cancellationSetBase,
                "cancellation.refund": {
                  ...refundSummaryBase,
                  status: "failed",
                  error: message,
                },
                updatedAt: now,
              },
            }
          );
          if (canceledNow || bookingAlreadyCanceled) {
            await userBookings.updateOne(
              { _id: bookingObjectId },
              { $set: { "booking.status": cancelStatusString || "4" } }
            );
          }
          return NextResponse.json(
            {
              error: canceledNow ? `Booking canceled, but refund failed: ${message}` : message,
              code: "refund_failed",
              bookingStatus: canceledNow || bookingAlreadyCanceled ? cancelStatusString || "4" : bookingStatus || null,
            },
            { status: 502 }
          );
        }
      }
    }

    const refundVerification = await verifyVposOperationState({
      operation: "refund",
      provider,
      orderId,
      language: paymentRecord.locale ?? null,
    });
    if (!refundVerification.verified) {
      const verificationMessage = buildVerificationErrorMessage(
        "refund",
        refundVerification.reason,
        refundVerification.lastError
      );
      const cancellationSetBase = buildCancellationSetBase(now);
      await vposPayments.updateOne(
        { _id: paymentRecord._id },
        {
          $set: {
            ...cancellationSetBase,
            refundStatus: "verification_failed",
            refundError: verificationMessage,
            refundAttempt: refundSummaryBase,
            "cancellation.refund": {
              ...refundSummaryBase,
              status: "verification_failed",
              error: verificationMessage,
              verification: {
                reason: refundVerification.reason,
                attempts: refundVerification.attempts,
                details: refundVerification.details?.raw ?? null,
              },
            },
            updatedAt: now,
          },
        }
      );
      await userBookings.updateOne(
        { _id: bookingObjectId },
        {
          $set: {
            ...cancellationSetBase,
            "cancellation.refund": {
              ...refundSummaryBase,
              status: "verification_failed",
              error: verificationMessage,
              verification: {
                reason: refundVerification.reason,
                attempts: refundVerification.attempts,
                details: refundVerification.details?.raw ?? null,
              },
            },
            updatedAt: now,
          },
        }
      );
      if (canceledNow || bookingAlreadyCanceled) {
        await userBookings.updateOne(
          { _id: bookingObjectId },
          { $set: { "booking.status": cancelStatusString || "4" } }
        );
      }
      return NextResponse.json(
        {
          error: verificationMessage,
          code: "refund_verification_failed",
          bookingStatus: canceledNow || bookingAlreadyCanceled ? cancelStatusString || "4" : bookingStatus || null,
        },
        { status: 502 }
      );
    }

    try {
      await runAoryxCancellationIfNeeded();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Aoryx cancellation failed.";
      const cancellationSetBase = buildCancellationSetBase(now);
      await vposPayments.updateOne(
        { _id: paymentRecord._id },
        {
          $set: {
            ...cancellationSetBase,
            "cancellation.refund": {
              ...refundSummaryBase,
              status: refundResponse.skipped ? "already_refunded" : "refunded",
              responseCode: refundResponse.responseCode,
              responseMessage: refundResponse.responseMessage,
              verification: {
                reason: refundVerification.reason,
                attempts: refundVerification.attempts,
                details: refundVerification.details?.raw ?? null,
              },
            },
            refundStatus: refundResponse.skipped ? "already_refunded" : "refunded",
            refund: {
              ...refundSummaryBase,
              ...refundResponse,
              verification: {
                reason: refundVerification.reason,
                attempts: refundVerification.attempts,
                details: refundVerification.details?.raw ?? null,
              },
            },
            cancellationError: message,
            updatedAt: now,
          },
        }
      );
      await userBookings.updateOne(
        { _id: bookingObjectId },
        {
          $set: {
            ...cancellationSetBase,
            "cancellation.refund": {
              ...refundSummaryBase,
              status: refundResponse.skipped ? "already_refunded" : "refunded",
              responseCode: refundResponse.responseCode,
              responseMessage: refundResponse.responseMessage,
              verification: {
                reason: refundVerification.reason,
                attempts: refundVerification.attempts,
                details: refundVerification.details?.raw ?? null,
              },
            },
            cancellationError: message,
            updatedAt: now,
          },
        }
      );
      return NextResponse.json(
        {
          error: `Refund verified, but booking cancellation failed: ${message}`,
          code: "aoryx_cancel_failed_after_refund",
          bookingStatus: bookingStatus || null,
        },
        { status: 502 }
      );
    }
    const cancellationSetBase = buildCancellationSetBase(now);

    await vposPayments.updateOne(
      { _id: paymentRecord._id },
      {
        $set: {
          ...cancellationSetBase,
          "cancellation.refund": {
            ...refundSummaryBase,
            status: refundResponse.skipped ? "already_refunded" : "refunded",
            responseCode: refundResponse.responseCode,
            responseMessage: refundResponse.responseMessage,
            verification: {
              reason: refundVerification.reason,
              attempts: refundVerification.attempts,
              details: refundVerification.details?.raw ?? null,
            },
          },
          refundStatus: refundResponse.skipped ? "already_refunded" : "refunded",
          refund: {
            ...refundSummaryBase,
            ...refundResponse,
            verification: {
              reason: refundVerification.reason,
              attempts: refundVerification.attempts,
              details: refundVerification.details?.raw ?? null,
            },
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
          ...cancellationSetBase,
          "cancellation.refund": {
            ...refundSummaryBase,
            status: refundResponse.skipped ? "already_refunded" : "refunded",
            responseCode: refundResponse.responseCode,
            responseMessage: refundResponse.responseMessage,
            verification: {
              reason: refundVerification.reason,
              attempts: refundVerification.attempts,
              details: refundVerification.details?.raw ?? null,
            },
          },
          updatedAt: now,
        },
      }
    );
    if (canceledNow || bookingAlreadyCanceled) {
      await userBookings.updateOne(
        { _id: bookingObjectId },
        { $set: { "booking.status": cancelStatusString || "4" } }
      );
    }

    return NextResponse.json({
      action: shouldCancelBooking ? "cancel_and_refund" : "refund",
      message: refundResponse.skipped
        ? "Payment was already refunded."
        : canceledNow
          ? "Booking canceled and refund requested successfully."
          : refundServices.length > 0
            ? "Partial refund requested successfully."
            : "Refund requested successfully.",
      bookingStatus: canceledNow || bookingAlreadyCanceled ? cancelStatusString || "4" : bookingStatus || null,
      refund: {
        ...refundSummaryBase,
        status: refundResponse.skipped ? "already_refunded" : "refunded",
        responseCode: refundResponse.responseCode,
        responseMessage: refundResponse.responseMessage,
        verification: {
          reason: refundVerification.reason,
          attempts: refundVerification.attempts,
          details: refundVerification.details?.raw ?? null,
        },
      },
    });
  } catch (error) {
    console.error("[Admin][booking-cancel] Failed to process booking action", error);
    const message = error instanceof Error ? error.message : "Failed to cancel booking.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
