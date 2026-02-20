import {
  searchWithOptions,
  type AoryxEnvironment,
  AoryxClientError,
  AoryxServiceError,
} from "@/lib/aoryx-client";
import { AORYX_TASSPRO_CUSTOMER_CODE, AORYX_TASSPRO_REGION_ID } from "@/lib/env";
import { getAoryxHotelB2BPlatformFee } from "@/lib/pricing";
import { applyMarkup } from "@/lib/pricing-utils";
import { isTechnicalErrorMessage } from "@/lib/error-utils";
import type { AoryxSearchParams, AoryxSearchResult } from "@/types/aoryx";

export type SafeSearchResult = Omit<AoryxSearchResult, "sessionId">;

export const withAoryxDefaults = (payload: AoryxSearchParams): AoryxSearchParams => ({
  ...payload,
  customerCode: payload.customerCode ?? AORYX_TASSPRO_CUSTOMER_CODE,
  regionId: payload.regionId ?? AORYX_TASSPRO_REGION_ID,
});

type RunAoryxSearchOptions = {
  environment?: AoryxEnvironment;
};

export async function runAoryxSearch(
  payload: AoryxSearchParams,
  options: RunAoryxSearchOptions = {}
): Promise<SafeSearchResult> {
  const params = withAoryxDefaults(payload);
  const result = await searchWithOptions(params, {
    environment: options.environment ?? "live",
  });
  const safeResult: SafeSearchResult = {
    currency: result.currency,
    propertyCount: result.propertyCount,
    responseTime: result.responseTime,
    destination: result.destination,
    hotels: result.hotels,
  };
  const hotelMarkup = await getAoryxHotelB2BPlatformFee();
  if (hotelMarkup && Array.isArray(safeResult.hotels)) {
    return {
      ...safeResult,
      hotels: safeResult.hotels.map((hotel) => ({
        ...hotel,
        minPrice: applyMarkup(hotel.minPrice, hotelMarkup) ?? hotel.minPrice,
      })),
    };
  }
  return safeResult;
}

export type SearchErrorInfo = { message: string; code?: string };

const toSearchMessage = (value: unknown): string => {
  if (typeof value !== "string") return "";
  const message = value.trim();
  if (!message || isTechnicalErrorMessage(message)) return "";
  return message;
};

export function normalizeSearchError(error: unknown): SearchErrorInfo {
  if (error instanceof AoryxServiceError) {
    return {
      message: toSearchMessage(error.message),
      code: error.code,
    };
  }
  if (error instanceof AoryxClientError) {
    return { message: toSearchMessage(error.message) };
  }
  if (error instanceof Error) {
    return { message: toSearchMessage(error.message) };
  }
  return { message: "" };
}
