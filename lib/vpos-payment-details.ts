import type { PaymentProvider } from "@/lib/vpos-refund";

type PaymentOperation = "cancel" | "refund";

type PaymentDetailsRequest = {
  provider: PaymentProvider;
  orderId: string;
  language?: string | null;
};

type VposPaymentDetails = {
  provider: PaymentProvider;
  orderStatus: number | null;
  paymentState: string | null;
  actionCode: number | null;
  actionCodeDescription: string | null;
  responseCode: string | null;
  responseMessage: string | null;
  errorCode: number | null;
  errorMessage: string | null;
  refundedAmount: number | null;
  raw: Record<string, unknown>;
};

type VposOperationVerification = {
  operation: PaymentOperation;
  verified: boolean;
  reason: string;
  attempts: number;
  details: VposPaymentDetails | null;
  lastError: string | null;
};

type VerifyOperationRequest = PaymentDetailsRequest & {
  operation: PaymentOperation;
  maxAttempts?: number;
  pollIntervalMs?: number;
};

type IdbankDetailsResponse = {
  orderStatus?: number | string;
  actionCode?: number | string;
  actionCodeDescription?: string;
  errorCode?: number | string;
  errorMessage?: string;
  PaymentState?: string;
  paymentState?: string;
  RefundedAmount?: number | string;
  refundedAmount?: number | string;
  paymentAmountInfo?: Record<string, unknown>;
  PaymentAmountInfo?: Record<string, unknown>;
};

type AmeriaDetailsResponse = {
  OrderStatus?: number | string;
  ActionCode?: number | string;
  ActionCodeDescription?: string;
  ResponseCode?: number | string;
  ResponseMessage?: string;
  PaymentState?: string;
  RefundedAmount?: number | string;
  refundedAmount?: number | string;
  paymentAmountInfo?: Record<string, unknown>;
  PaymentAmountInfo?: Record<string, unknown>;
};

const IDBANK_DEFAULT_BASE_URL = "https://ipaytest.arca.am:8445/payment/rest";
const AMERIA_DEFAULT_BASE_URL = "https://servicestest.ameriabank.am/VPOS";
const DEFAULT_LANGUAGE = "en";
const DEFAULT_VERIFY_ATTEMPTS = 6;
const DEFAULT_VERIFY_INTERVAL_MS = 1200;

const normalizeBaseUrl = (value: string) => value.trim().replace(/\/+$/, "");

const resolveString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const toNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const normalizeLanguage = (value: string | null | undefined) => {
  const normalized = (value ?? DEFAULT_LANGUAGE).trim().toLowerCase();
  if (normalized === "hy" || normalized === "ru" || normalized === "en") return normalized;
  return DEFAULT_LANGUAGE;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readField = (record: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    if (record[key] != null) {
      return record[key];
    }
  }
  return undefined;
};

const extractJsonResponse = async (response: Response): Promise<Record<string, unknown>> => {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch (error) {
    const text = await response.text().catch(() => "");
    console.error("[Vpos][payment-details] Invalid JSON response", text, error);
    throw new Error("Invalid gateway response.");
  }
};

const resolveRefundedAmount = (payload: Record<string, unknown>) => {
  const direct = toNumber(readField(payload, ["RefundedAmount", "refundedAmount"]));
  if (direct !== null) return direct;
  const amountInfo = isRecord(readField(payload, ["paymentAmountInfo", "PaymentAmountInfo"]))
    ? (readField(payload, ["paymentAmountInfo", "PaymentAmountInfo"]) as Record<string, unknown>)
    : null;
  return toNumber(readField(amountInfo ?? {}, ["RefundedAmount", "refundedAmount"]));
};

const fetchIdbankPaymentDetails = async (
  params: PaymentDetailsRequest
): Promise<VposPaymentDetails> => {
  const baseUrl = normalizeBaseUrl(resolveString(process.env.VPOS_BASE_URL) || IDBANK_DEFAULT_BASE_URL);
  const userName = resolveString(process.env.VPOS_USER);
  const password = resolveString(process.env.VPOS_PASSWORD);
  if (!baseUrl || !userName || !password) {
    throw new Error("Missing IDBank VPOS credentials.");
  }

  const requestParams = new URLSearchParams();
  requestParams.set("userName", userName);
  requestParams.set("password", password);
  requestParams.set("orderId", params.orderId);
  requestParams.set("language", normalizeLanguage(params.language));

  const response = await fetch(`${baseUrl}/getOrderStatusExtended.do`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: requestParams.toString(),
  });

  const payload = (await extractJsonResponse(response)) as IdbankDetailsResponse & Record<string, unknown>;
  if (!response.ok) {
    const message =
      resolveString(payload.errorMessage) || "IDBank payment details request failed.";
    throw new Error(message);
  }

  return {
    provider: "idbank",
    orderStatus: toNumber(payload.orderStatus),
    paymentState:
      resolveString(payload.PaymentState) || resolveString(payload.paymentState) || null,
    actionCode: toNumber(payload.actionCode),
    actionCodeDescription: resolveString(payload.actionCodeDescription) || null,
    responseCode: null,
    responseMessage: null,
    errorCode: toNumber(payload.errorCode),
    errorMessage: resolveString(payload.errorMessage) || null,
    refundedAmount: resolveRefundedAmount(payload),
    raw: payload,
  };
};

const fetchAmeriaPaymentDetails = async (
  params: PaymentDetailsRequest
): Promise<VposPaymentDetails> => {
  const baseUrl = normalizeBaseUrl(resolveString(process.env.AMERIA_VPOS_BASE_URL) || AMERIA_DEFAULT_BASE_URL);
  const userName = resolveString(process.env.AMERIA_VPOS_USERNAME);
  const password = resolveString(process.env.AMERIA_VPOS_PASSWORD);
  if (!baseUrl || !userName || !password) {
    throw new Error("Missing Ameriabank VPOS credentials.");
  }

  const requestBody = {
    PaymentID: params.orderId,
    Username: userName,
    Password: password,
  };

  const response = await fetch(
    `${baseUrl}/api/VPOS/GetPaymentDetails?lang=${encodeURIComponent(normalizeLanguage(params.language))}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    }
  );

  const payload = (await extractJsonResponse(response)) as AmeriaDetailsResponse & Record<string, unknown>;
  if (!response.ok) {
    const message =
      resolveString(payload.ResponseMessage) || "Ameriabank payment details request failed.";
    throw new Error(message);
  }

  return {
    provider: "ameriabank",
    orderStatus: toNumber(payload.OrderStatus),
    paymentState: resolveString(payload.PaymentState) || null,
    actionCode: toNumber(payload.ActionCode),
    actionCodeDescription: resolveString(payload.ActionCodeDescription) || null,
    responseCode: resolveString(payload.ResponseCode) || null,
    responseMessage: resolveString(payload.ResponseMessage) || null,
    errorCode: toNumber(payload.ResponseCode),
    errorMessage: resolveString(payload.ResponseMessage) || null,
    refundedAmount: resolveRefundedAmount(payload),
    raw: payload,
  };
};

const assessOperationState = (
  operation: PaymentOperation,
  details: VposPaymentDetails
): { verified: boolean; terminal: boolean; reason: string } => {
  const orderStatus = details.orderStatus;
  const paymentState = (details.paymentState ?? "").trim().toLowerCase();
  const refundedAmount = details.refundedAmount;
  const failedState = /fail|declin|reject|error|denied/.test(paymentState);

  if (operation === "refund") {
    const isRefunded =
      orderStatus === 4 ||
      paymentState.includes("refund") ||
      (typeof refundedAmount === "number" && Number.isFinite(refundedAmount) && refundedAmount > 0);
    if (isRefunded) {
      return { verified: true, terminal: true, reason: "refund_confirmed" };
    }
    if (failedState || orderStatus === 6) {
      return { verified: false, terminal: true, reason: "refund_failed_state" };
    }
    return { verified: false, terminal: false, reason: "refund_pending_state" };
  }

  const isCanceled =
    orderStatus === 3 ||
    paymentState.includes("cancel") ||
    paymentState.includes("reverse") ||
    paymentState.includes("void");
  if (isCanceled) {
    return { verified: true, terminal: true, reason: "cancel_confirmed" };
  }
  if (orderStatus === 4 || paymentState.includes("refund")) {
    return { verified: false, terminal: true, reason: "refund_state_detected" };
  }
  if (failedState || orderStatus === 6) {
    return { verified: false, terminal: true, reason: "cancel_failed_state" };
  }
  return { verified: false, terminal: false, reason: "cancel_pending_state" };
};

export const getVposPaymentDetails = async (
  params: PaymentDetailsRequest
): Promise<VposPaymentDetails> => {
  if (params.provider === "ameriabank") {
    return fetchAmeriaPaymentDetails(params);
  }
  return fetchIdbankPaymentDetails(params);
};

export const verifyVposOperationState = async (
  params: VerifyOperationRequest
): Promise<VposOperationVerification> => {
  const maxAttempts =
    typeof params.maxAttempts === "number" && Number.isFinite(params.maxAttempts) && params.maxAttempts > 0
      ? Math.round(params.maxAttempts)
      : DEFAULT_VERIFY_ATTEMPTS;
  const pollIntervalMs =
    typeof params.pollIntervalMs === "number" && Number.isFinite(params.pollIntervalMs) && params.pollIntervalMs >= 0
      ? Math.round(params.pollIntervalMs)
      : DEFAULT_VERIFY_INTERVAL_MS;

  let attempts = 0;
  let lastDetails: VposPaymentDetails | null = null;
  let lastError: string | null = null;
  let lastReason = `${params.operation}_verification_unresolved`;

  while (attempts < maxAttempts) {
    attempts += 1;
    try {
      const details = await getVposPaymentDetails(params);
      lastDetails = details;
      const assessment = assessOperationState(params.operation, details);
      lastReason = assessment.reason;
      if (assessment.verified) {
        return {
          operation: params.operation,
          verified: true,
          reason: assessment.reason,
          attempts,
          details,
          lastError: null,
        };
      }
      if (assessment.terminal) {
        return {
          operation: params.operation,
          verified: false,
          reason: assessment.reason,
          attempts,
          details,
          lastError: null,
        };
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Payment details verification failed.";
      lastReason = `${params.operation}_details_error`;
    }

    if (attempts < maxAttempts && pollIntervalMs > 0) {
      await sleep(pollIntervalMs);
    }
  }

  return {
    operation: params.operation,
    verified: false,
    reason: lastReason,
    attempts,
    details: lastDetails,
    lastError,
  };
};

export type {
  PaymentOperation,
  PaymentDetailsRequest,
  VerifyOperationRequest,
  VposPaymentDetails,
  VposOperationVerification,
};
