export type InsuranceIssuanceStatus =
  | "not_selected"
  | "pending"
  | "confirmed"
  | "failed";

export type InsuranceIssuanceSummary = {
  status: InsuranceIssuanceStatus;
  errorMessage: string | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const toOptionalText = (value: unknown): string | null => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
};

const isTruthyErrorFlag = (value: unknown) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes";
  }
  return false;
};

const isNonZeroCode = (value: unknown) => {
  if (typeof value === "number") return Number.isFinite(value) && value !== 0;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed !== 0;
  }
  return false;
};

export const resolveEfesPolicyResponseFailure = (value: unknown): string | null => {
  if (!isRecord(value)) return "EFES returned an invalid policy response.";
  const response = isRecord(value.response) ? value.response : value;
  const message =
    toOptionalText(response.error_msg) ??
    toOptionalText(response.d_error_msg) ??
    null;
  const failed =
    isTruthyErrorFlag(response.is_error) ||
    isNonZeroCode(response.error_code) ||
    isNonZeroCode(response.d_error_code);
  if (failed) return message ?? "EFES did not issue the insurance policy.";

  const result = toOptionalText(response.result);
  if (!result) return "EFES did not return an insurance policy number.";
  return null;
};

export const hasIssuedEfesPolicy = (insurancePolicies: unknown): boolean =>
  Array.isArray(insurancePolicies) &&
  insurancePolicies.some((policy) => resolveEfesPolicyResponseFailure(policy) === null);

export const resolveInsuranceIssuance = (input: {
  insuranceSelected: boolean;
  insurancePolicies?: unknown;
  insuranceError?: unknown;
}): InsuranceIssuanceSummary => {
  if (!input.insuranceSelected) {
    return { status: "not_selected", errorMessage: null };
  }

  const storedError = toOptionalText(input.insuranceError);
  if (storedError) {
    return { status: "failed", errorMessage: storedError };
  }

  if (!Array.isArray(input.insurancePolicies) || input.insurancePolicies.length === 0) {
    return { status: "pending", errorMessage: null };
  }

  for (const policy of input.insurancePolicies) {
    const failure = resolveEfesPolicyResponseFailure(policy);
    if (failure) return { status: "failed", errorMessage: failure };
  }

  return { status: "confirmed", errorMessage: null };
};

export const formatDateInTimeZone = (value: Date, timeZone: string): string => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  const year = byType.get("year");
  const month = byType.get("month");
  const day = byType.get("day");
  if (!year || !month || !day) {
    throw new Error(`Unable to format date in ${timeZone}.`);
  }
  return `${year}-${month}-${day}`;
};

export const formatEfesPolicyCreationDate = (value: Date = new Date()) =>
  formatDateInTimeZone(value, "Asia/Yerevan");
