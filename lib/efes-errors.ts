export type EfesInsuranceErrorCopy = {
  invalidDays: string;
  ageLimit: string;
};

const INVALID_DAYS_CODE = "error_calc_travel_005";
const INVALID_DAYS_MESSAGE_HY = "Ճանապարհորդության օրերի քանակը սխալ է լրացված";
const AGE_LIMIT_CODE = "error_calc_travel_001";
const AGE_LIMIT_MESSAGE_HY = "100 տարեկանից բարձր անձինք չեն կարող ապահովագրվել";
const AGE_LIMIT_MESSAGE_EN = "over 100";
const AGE_LIMIT_MESSAGE_RU = "старше 100";

export type EfesInsuranceErrorKind = "invalidDays" | "ageLimit" | null;

export const resolveEfesErrorKind = (message: string): EfesInsuranceErrorKind => {
  if (!message) return null;
  const normalized = message.toLowerCase();
  if (normalized.includes(INVALID_DAYS_CODE) || message.includes(INVALID_DAYS_MESSAGE_HY)) {
    return "invalidDays";
  }
  if (
    normalized.includes(AGE_LIMIT_CODE) ||
    message.includes(AGE_LIMIT_MESSAGE_HY) ||
    normalized.includes(AGE_LIMIT_MESSAGE_EN) ||
    normalized.includes(AGE_LIMIT_MESSAGE_RU)
  ) {
    return "ageLimit";
  }
  return null;
};

export const mapEfesErrorMessage = (
  message: string,
  copy: EfesInsuranceErrorCopy,
  fallbackMessage?: string
): string => {
  const kind = resolveEfesErrorKind(message);
  if (kind === "invalidDays") return copy.invalidDays;
  if (kind === "ageLimit") return copy.ageLimit;
  return fallbackMessage ?? message;
};
