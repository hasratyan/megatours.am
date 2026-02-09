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

const extractErrorMessage = (data: ErrorResponseData | null, status: number) =>
  typeof data?.error === "string" && data.error.trim().length > 0
    ? data.error
    : `HTTP error ${status}`;

const extractErrorCode = (data: ErrorResponseData | null) =>
  typeof data?.code === "string" && data.code.trim().length > 0 ? data.code.trim() : null;

/**
 * Helper function to make POST requests with JSON body
 */
export async function postJson<T>(url: string, payload: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorData = await parseErrorData(response);
    throw new ApiError(extractErrorMessage(errorData, response.status), {
      status: response.status,
      code: extractErrorCode(errorData),
      data: errorData,
    });
  }

  return response.json() as Promise<T>;
}

/**
 * Helper function to make GET requests
 */
export async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    const errorData = await parseErrorData(response);
    throw new ApiError(extractErrorMessage(errorData, response.status), {
      status: response.status,
      code: extractErrorCode(errorData),
      data: errorData,
    });
  }

  return response.json() as Promise<T>;
}
