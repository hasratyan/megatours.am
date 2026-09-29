import { createSearchTiming } from "@/lib/search-timing";
import {
  searchWithOptions,
  type AoryxEnvironment,
  AoryxClientError,
  AoryxServiceError,
} from "@/lib/aoryx-client";
import {
  AORYX_RUNTIME_ENV,
  AORYX_TASSPRO_CUSTOMER_CODE,
  AORYX_TASSPRO_REGION_ID,
} from "@/lib/env";
import { getAoryxHotelB2BPlatformFee } from "@/lib/pricing";
import { applyMarkup } from "@/lib/pricing-utils";
import { isTechnicalErrorMessage } from "@/lib/error-utils";
import { createSearchToken } from "@/lib/aoryx-rate-tokens";
import type { AoryxSearchParams, AoryxSearchResult } from "@/types/aoryx";
import { resolveAoryxSearchArea } from "@/lib/aoryx-areas";
import { isHotelInAoryxArea } from "@/lib/aoryx-area-filter";

export type SafeSearchResult = Omit<AoryxSearchResult, "sessionId"> & {
  searchToken?: string | null;
};

export const withAoryxDefaults = (payload: AoryxSearchParams): AoryxSearchParams => ({
  ...payload,
  customerCode: payload.customerCode ?? AORYX_TASSPRO_CUSTOMER_CODE,
  regionId: payload.regionId ?? AORYX_TASSPRO_REGION_ID,
});

type RunAoryxSearchOptions = {
  environment?: AoryxEnvironment;
  signal?: AbortSignal;
  timing?: ReturnType<typeof createSearchTiming>;
};

export async function runAoryxSearch(
  payload: AoryxSearchParams,
  options: RunAoryxSearchOptions = {}
): Promise<SafeSearchResult> {
  const params = withAoryxDefaults(payload);
  const timing = options.timing ?? createSearchTiming();
  const [result, hotelMarkup] = await Promise.all([
    timing.measure("supplier_search", () => searchWithOptions(params, {
      environment: options.environment ?? AORYX_RUNTIME_ENV,
      signal: options.signal,
    })),
    timing.measure("pricing", () => getAoryxHotelB2BPlatformFee()),
  ]);
  options.signal?.throwIfAborted();
  const area = resolveAoryxSearchArea(params.areaId, params.destinationCode, params.hotelCode);
  const hotels = area
    ? result.hotels.filter((hotel) => isHotelInAoryxArea(hotel.latitude, hotel.longitude, area.id))
    : result.hotels;
  const safeResult: SafeSearchResult = {
    currency: result.currency,
    propertyCount: area ? hotels.length : result.propertyCount,
    responseTime: result.responseTime,
    destination: result.destination,
    hotels,
    searchToken: createSearchToken({ sessionId: result.sessionId, searchParams: params }),
  };
  if (hotelMarkup && Array.isArray(safeResult.hotels)) {
    return {
      ...safeResult,
      hotels: safeResult.hotels.map((hotel) => ({
        ...hotel,
        minPrice: applyMarkup(hotel.minPrice, hotelMarkup) ?? hotel.minPrice,
        availableRates: hotel.availableRates?.map((rate) => ({
          ...rate,
          amount: applyMarkup(rate.amount, hotelMarkup) ?? rate.amount,
        })),
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
    // Client errors describe configuration, transport, timeout, or response
    // parsing failures. Keep those details in server logs, not customer copy.
    return { message: "" };
  }
  if (error instanceof Error) {
    return { message: toSearchMessage(error.message) };
  }
  return { message: "" };
}
