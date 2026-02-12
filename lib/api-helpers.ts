import {
  DEFAULT_USER_ERROR_MESSAGE,
  resolveSafeErrorFromUnknown,
  resolveSafeErrorMessage,
} from "@/lib/error-utils";

type ErrorResponseData = {
  error?: unknown;
  code?: unknown;
  [key: string]: unknown;
};

type ApiErrorOptions = {
  status: number;
  code: string | null;
  data: ErrorResponseData | null;
};

export class ApiError extends Error {
  status: number;
  code: string | null;
  data: ErrorResponseData | null;

  constructor(message: string, options: ApiErrorOptions) {
    super(message);
    this.name = "ApiError";
    this.status = options.status;
    this.code = options.code;
    this.data = options.data;
  }
}

const parseErrorData = async (response: Response): Promise<ErrorResponseData | null> => {
  const parsed = await response.json().catch(() => null);
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  return parsed as ErrorResponseData;
};

const SERVER_ERROR_FALLBACK = "Service is temporarily unavailable. Please try again.";
const buildFallbackMessage = (status: number) =>
  status >= 500 ? SERVER_ERROR_FALLBACK : DEFAULT_USER_ERROR_MESSAGE;

const extractErrorMessage = (data: ErrorResponseData | null, status: number) =>
  resolveSafeErrorMessage(
    typeof data?.error === "string" && data.error.trim().length > 0
      ? data.error
      : `HTTP error ${status}`,
    buildFallbackMessage(status)
  );

const extractErrorCode = (data: ErrorResponseData | null) =>
  typeof data?.code === "string" && data.code.trim().length > 0 ? data.code.trim() : null;

const parseResponseBody = async <T>(response: Response): Promise<T> => {
  try {
    return (await response.json()) as T;
  } catch (error) {
    throw new ApiError(resolveSafeErrorFromUnknown(error, DEFAULT_USER_ERROR_MESSAGE), {
      status: response.status,
      code: null,
      data: null,
    });
  }
};

const requestJson = async <T>(url: string, init: RequestInit): Promise<T> => {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw new ApiError(resolveSafeErrorFromUnknown(error, DEFAULT_USER_ERROR_MESSAGE), {
      status: 0,
      code: null,
      data: null,
    });
  }

  if (!response.ok) {
    const errorData = await parseErrorData(response);
    throw new ApiError(extractErrorMessage(errorData, response.status), {
      status: response.status,
      code: extractErrorCode(errorData),
      data: errorData,
    });
  }

  return parseResponseBody<T>(response);
};

/**
 * Helper function to make POST requests with JSON body
 */
export async function postJson<T>(url: string, payload: unknown): Promise<T> {
  return requestJson<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/**
 * Helper function to make GET requests
 */
export async function getJson<T>(url: string): Promise<T> {
  return requestJson<T>(url, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });
}
