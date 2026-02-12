const TECHNICAL_ERROR_PATTERNS = [
  /aborterror/i,
  /timeout/i,
  /timed out/i,
  /\b\d{3,}\s*ms\b/i,
  /failed to fetch/i,
  /fetch failed/i,
  /network error/i,
  /network request failed/i,
  /socket hang up/i,
  /http error/i,
  /status code/i,
  /internal server error/i,
  /bad gateway/i,
  /service unavailable/i,
  /gateway timeout/i,
  /\bECONNRESET\b/i,
  /\bECONNREFUSED\b/i,
  /\bETIMEDOUT\b/i,
  /\bENOTFOUND\b/i,
  /\bEAI_AGAIN\b/i,
  /aoryx api error/i,
];

export const DEFAULT_USER_ERROR_MESSAGE = "Something went wrong. Please try again.";

export const isTechnicalErrorMessage = (value: unknown): boolean => {
  if (typeof value !== "string") return true;
  const message = value.trim();
  if (!message) return true;
  return TECHNICAL_ERROR_PATTERNS.some((pattern) => pattern.test(message));
};

export const resolveSafeErrorMessage = (
  message: unknown,
  fallbackMessage: string = DEFAULT_USER_ERROR_MESSAGE
): string => {
  const fallback =
    typeof fallbackMessage === "string" && fallbackMessage.trim().length > 0
      ? fallbackMessage.trim()
      : DEFAULT_USER_ERROR_MESSAGE;
  if (typeof message !== "string") return fallback;
  const normalized = message.trim();
  if (!normalized) return fallback;
  return isTechnicalErrorMessage(normalized) ? fallback : normalized;
};

export const resolveSafeErrorFromUnknown = (
  error: unknown,
  fallbackMessage: string = DEFAULT_USER_ERROR_MESSAGE
): string => {
  if (error instanceof Error) {
    return resolveSafeErrorMessage(error.message, fallbackMessage);
  }
  return resolveSafeErrorMessage(null, fallbackMessage);
};
