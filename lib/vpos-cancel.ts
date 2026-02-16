type PaymentProvider = "idbank" | "ameriabank";

type CancelRequest = {
  provider: PaymentProvider;
  orderId: string;
  language?: string | null;
};

type CancelResult = {
  provider: PaymentProvider;
  responseCode: string | null;
  responseMessage: string | null;
  raw: Record<string, unknown>;
};

type IdbankCancelResponse = {
  errorCode?: number | string;
  errorMessage?: string;
  actionCode?: number | string;
  actionCodeDescription?: string;
};

type AmeriaCancelResponse = {
  ResponseCode?: number | string;
  ResponseMessage?: string;
};

const IDBANK_DEFAULT_BASE_URL = "https://ipaytest.arca.am:8445/payment/rest";
const AMERIA_DEFAULT_BASE_URL = "https://servicestest.ameriabank.am/VPOS";

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

const extractJsonResponse = async (response: Response): Promise<Record<string, unknown>> => {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch (error) {
    const text = await response.text().catch(() => "");
    console.error("[Vpos][cancel] Invalid JSON response", text, error);
    throw new Error("Invalid gateway response.");
  }
};

const normalizeLanguage = (value: string | null | undefined) => {
  const normalized = (value ?? "en").trim().toLowerCase();
  if (normalized === "hy" || normalized === "ru" || normalized === "en") return normalized;
  return "en";
};

const cancelIdbankPayment = async (params: CancelRequest): Promise<CancelResult> => {
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

  const response = await fetch(`${baseUrl}/reverse.do`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: requestParams.toString(),
  });

  const payload = (await extractJsonResponse(response)) as IdbankCancelResponse & Record<string, unknown>;
  const errorCode = toNumber(payload.errorCode);
  const actionCode = toNumber(payload.actionCode);
  const responseMessage =
    typeof payload.errorMessage === "string" && payload.errorMessage.trim().length > 0
      ? payload.errorMessage.trim()
      : typeof payload.actionCodeDescription === "string" && payload.actionCodeDescription.trim().length > 0
        ? payload.actionCodeDescription.trim()
        : null;

  if (!response.ok || (errorCode !== null && errorCode !== 0) || (actionCode !== null && actionCode !== 0)) {
    throw new Error(responseMessage || "IDBank cancel request failed.");
  }

  return {
    provider: "idbank",
    responseCode: errorCode !== null ? String(errorCode) : actionCode !== null ? String(actionCode) : null,
    responseMessage,
    raw: payload,
  };
};

const cancelAmeriaPayment = async (params: CancelRequest): Promise<CancelResult> => {
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

  const response = await fetch(`${baseUrl}/api/VPOS/CancelPayment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });

  const payload = (await extractJsonResponse(response)) as AmeriaCancelResponse & Record<string, unknown>;
  const responseCode =
    typeof payload.ResponseCode === "number" || typeof payload.ResponseCode === "string"
      ? String(payload.ResponseCode).trim()
      : "";
  const responseMessage =
    typeof payload.ResponseMessage === "string" && payload.ResponseMessage.trim().length > 0
      ? payload.ResponseMessage.trim()
      : null;
  const isSuccessful = responseCode === "00" || responseCode === "0";

  if (!response.ok || !isSuccessful) {
    throw new Error(responseMessage || "Ameriabank cancel request failed.");
  }

  return {
    provider: "ameriabank",
    responseCode: responseCode || null,
    responseMessage,
    raw: payload,
  };
};

export const cancelVposPayment = async (params: CancelRequest): Promise<CancelResult> => {
  if (params.provider === "ameriabank") {
    return cancelAmeriaPayment(params);
  }
  return cancelIdbankPayment(params);
};

export type { PaymentProvider, CancelRequest, CancelResult };
