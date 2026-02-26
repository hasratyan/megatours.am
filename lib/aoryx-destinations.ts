import { AoryxClientError, AoryxServiceError } from "@/lib/aoryx-client";
import {
  AORYX_ACTIVE_API_KEY,
  AORYX_ACTIVE_BASE_URL,
  AORYX_ACTIVE_CUSTOMER_CODE,
  AORYX_RUNTIME_ENV,
  AORYX_TIMEOUT_MS,
} from "@/lib/env";
import { resolveSafeErrorMessage } from "@/lib/error-utils";

const EXCLUDED_DESTINATION_CODES = new Set(["650", "650-0"]);
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

export type AoryxDestination = {
  destinationCode: string;
  name: string;
};

type DestinationLookupInput = {
  countryCode?: string;
  q?: string;
  limit?: number;
};

const toStringValue = (value: unknown) => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
};

const normalizeCountryCode = (value: string | undefined) => {
  if (!value) return "AE";
  const trimmed = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(trimmed) ? trimmed : "AE";
};

const normalizeLimit = (value: number | undefined) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_LIMIT;
  if (value < 1) return 1;
  if (value > MAX_LIMIT) return MAX_LIMIT;
  return Math.floor(value);
};

const normalizeDestinationCode = (rawCode: string) => {
  const trimmed = rawCode.trim();
  if (!trimmed) return null;
  return trimmed.includes("-") ? trimmed : `${trimmed}-0`;
};

const isTopLevelDestinationCode = (destinationCode: string) => destinationCode.endsWith("-0");

const includesQuery = (destination: AoryxDestination, query: string | null) => {
  if (!query) return true;
  const normalized = query.toLowerCase();
  return (
    destination.destinationCode.toLowerCase().includes(normalized) ||
    destination.name.toLowerCase().includes(normalized)
  );
};

export async function listAoryxDestinations(
  input: DestinationLookupInput = {}
): Promise<{ countryCode: string; destinations: AoryxDestination[] }> {
  const apiKeyName = AORYX_RUNTIME_ENV === "test" ? "AORYX_TEST_API_KEY" : "AORYX_API_KEY";
  const baseUrlName = AORYX_RUNTIME_ENV === "test" ? "AORYX_TEST_URL" : "AORYX_BASE_URL";
  if (!AORYX_ACTIVE_API_KEY) {
    throw new AoryxClientError(`Missing ${apiKeyName} configuration`, "country-info");
  }
  if (!AORYX_ACTIVE_BASE_URL) {
    throw new AoryxClientError(`Missing ${baseUrlName} configuration`, "country-info");
  }

  const countryCode = normalizeCountryCode(input.countryCode);
  const query = toStringValue(input.q)?.toLowerCase() ?? null;
  const limit = normalizeLimit(input.limit);
  const baseUrl = AORYX_ACTIVE_BASE_URL.replace(/\/$/, "");
  const url = `${baseUrl}/country-info`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AORYX_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ApiKey: AORYX_ACTIVE_API_KEY,
        ...(AORYX_ACTIVE_CUSTOMER_CODE ? { CustomerCode: AORYX_ACTIVE_CUSTOMER_CODE } : {}),
      },
      body: JSON.stringify({ CountryCode: countryCode }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new AoryxClientError(
        resolveSafeErrorMessage(
          `Aoryx API error: ${response.status} ${response.statusText}`,
          "Failed to fetch destinations"
        ),
        "country-info",
        response.status
      );
    }

    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const isSuccess = payload?.isSuccess ?? payload?.IsSuccess;
    const exceptionMessage = toStringValue(payload?.exceptionMessage ?? payload?.ExceptionMessage);
    const statusCode = payload?.statusCode ?? payload?.StatusCode;
    const numericStatusCode =
      typeof statusCode === "number" && Number.isFinite(statusCode) ? statusCode : undefined;

    if (isSuccess === false) {
      throw new AoryxServiceError(
        resolveSafeErrorMessage(exceptionMessage ?? "country-info request failed", "Failed to fetch destinations"),
        "DESTINATIONS_ERROR",
        numericStatusCode,
        payload
      );
    }

    const rawItems = payload?.data ?? payload?.Data;
    const items = Array.isArray(rawItems) ? rawItems : [];
    const destinationsByCode = new Map<string, AoryxDestination>();

    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const rawCode = toStringValue(record.key ?? record.Key);
      if (!rawCode) continue;

      const destinationCode = normalizeDestinationCode(rawCode);
      if (!destinationCode) continue;
      if (!isTopLevelDestinationCode(destinationCode)) continue;
      if (
        EXCLUDED_DESTINATION_CODES.has(destinationCode) ||
        EXCLUDED_DESTINATION_CODES.has(rawCode)
      ) {
        continue;
      }

      const name = toStringValue(record.value ?? record.Value) ?? destinationCode;
      if (!destinationsByCode.has(destinationCode)) {
        destinationsByCode.set(destinationCode, { destinationCode, name });
      }
    }

    const destinations = Array.from(destinationsByCode.values())
      .filter((destination) => includesQuery(destination, query))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, limit);

    return { countryCode, destinations };
  } catch (error) {
    if (error instanceof AoryxServiceError || error instanceof AoryxClientError) {
      throw error;
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new AoryxClientError("Failed to fetch destinations", "country-info");
    }
    throw new AoryxClientError(
      resolveSafeErrorMessage(
        error instanceof Error ? error.message : null,
        "Failed to fetch destinations"
      ),
      "country-info"
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
