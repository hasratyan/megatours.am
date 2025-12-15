// Aoryx API Client
import {
  AORYX_API_KEY,
  AORYX_BASE_URL,
  AORYX_CUSTOMER_CODE,
  AORYX_TIMEOUT_MS,
  AORYX_DEFAULT_CURRENCY,
  AORYX_TASSPRO_CUSTOMER_CODE,
  AORYX_TASSPRO_REGION_ID,
} from "./env";
import type {
  AoryxSearchParams,
  AoryxSearchRequest,
  AoryxSearchResponse,
  AoryxSearchResult,
  AoryxHotelSummary,
  AoryxSearchHotel,
  AoryxHotelsInfoByDestinationIdRequest,
  AoryxHotelsInfoByDestinationIdResponse,
  HotelInfo,
} from "@/types/aoryx";

// Endpoint configurations
const DISTRIBUTION_ENDPOINTS = {
  search: "Search",
  roomDetails: "RoomDetails",
  priceBreakup: "PriceBreakup",
  cancellationPolicy: "CancellationPolicy",
  preBook: "PreBook",
  book: "Book",
  cancel: "Cancel",
  bookingDetails: "BookingDetails",
} as const;

const STATIC_ENDPOINTS = {
  destinationInfo: "destination-info",
  hotelsInfoByDestinationId: "HotelsInfoByDestinationId",
  hotelInfo: "hotel-Info",
  countryInfo: "country-info",
} as const;

type AoryxDistributionEndpoint = (typeof DISTRIBUTION_ENDPOINTS)[keyof typeof DISTRIBUTION_ENDPOINTS];
type AoryxStaticEndpoint = (typeof STATIC_ENDPOINTS)[keyof typeof STATIC_ENDPOINTS];

// Request options
interface AoryxRequestOptions {
  timeoutMs?: number;
}

// Error classes
export class AoryxClientError extends Error {
  constructor(
    message: string,
    public endpoint?: string,
    public statusCode?: number
  ) {
    super(message);
    this.name = "AoryxClientError";
  }
}

export class AoryxServiceError extends Error {
  constructor(
    message: string,
    public code?: string,
    public statusCode?: number,
    public errors?: unknown
  ) {
    super(message);
    this.name = "AoryxServiceError";
  }
}

// Utility functions
function toStringValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toInteger(value: unknown): number | null {
  const num = toNumber(value);
  return num !== null ? Math.round(num) : null;
}

// Convert camelCase keys to PascalCase for Aoryx API
function pascalizeKeys(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(pascalizeKeys);
  }
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      const pascalKey = key.charAt(0).toUpperCase() + key.slice(1);
      result[pascalKey] = pascalizeKeys(val);
    }
    return result;
  }
  return value;
}

// Ensure base URL is available
function ensureBaseUrl(): string {
  if (!AORYX_BASE_URL) {
    throw new AoryxClientError("Missing AORYX_BASE_URL configuration");
  }
  return AORYX_BASE_URL.replace(/\/$/, "");
}

// Core request function
async function coreRequest<TRequest, TResponse>(
  endpoint: AoryxDistributionEndpoint | AoryxStaticEndpoint,
  payload: TRequest,
  options: AoryxRequestOptions = {}
): Promise<TResponse> {
  if (!AORYX_API_KEY) {
    throw new AoryxClientError("Missing AORYX_API_KEY configuration", endpoint);
  }

  const baseUrl = ensureBaseUrl();
  const url = `${baseUrl}/${endpoint}`;
  const timeoutMs = options.timeoutMs ?? AORYX_TIMEOUT_MS;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // Convert camelCase keys to PascalCase for Aoryx API
  const pascalizedPayload = pascalizeKeys(payload);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ApiKey: AORYX_API_KEY,
        ...(AORYX_CUSTOMER_CODE ? { CustomerCode: AORYX_CUSTOMER_CODE } : {}),
      },
      body: JSON.stringify(pascalizedPayload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new AoryxClientError(
        `Aoryx API error: ${response.status} ${response.statusText}`,
        endpoint,
        response.status
      );
    }

    const data = await response.json();
    return data as TResponse;
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof AoryxClientError) {
      throw error;
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw new AoryxClientError(`Request timeout after ${timeoutMs}ms`, endpoint);
    }

    throw new AoryxClientError(
      error instanceof Error ? error.message : "Unknown error",
      endpoint
    );
  }
}

// Normalize hotel from search response
function normalizeSearchHotel(hotel: AoryxSearchHotel, currency: string | null): AoryxHotelSummary {
  const info = hotel.hotelInfo;
  return {
    code: toStringValue(hotel.code),
    name: toStringValue(hotel.name) ?? toStringValue(info?.name),
    minPrice: toNumber(hotel.minPrice),
    currency: currency,
    rating: toNumber(info?.starRating), // API uses "starRating" as string
    address: toStringValue(info?.add1), // API uses "add1" for address
    city: toStringValue(info?.city),
    imageUrl: toStringValue(info?.image), // API uses "image" not "imageUrl"
    latitude: toNumber(info?.lat), // Direct string, not in geoCode
    longitude: toNumber(info?.lon), // Direct string, not in geoCode
  };
}

// Build search request from params
function buildSearchRequest(params: AoryxSearchParams): AoryxSearchRequest {
  const rooms = params.rooms.map((room) => ({
    RoomIdentifier: room.roomIdentifier,
    Adult: room.adults, // API uses "Adult" (singular)
    Children: room.childrenAges.length > 0
      ? {
          Count: room.childrenAges.length,
          ChildAge: room.childrenAges.map((age, index) => ({
            Identifier: index + 1,
            Text: age.toString(),
          })),
        }
      : undefined,
  }));

  return {
    SearchParameter: {
      DestinationCode: params.destinationCode,
      HotelCode: params.hotelCode,
      CountryCode: params.countryCode,
      Nationality: params.nationality,
      Currency: params.currency ?? AORYX_DEFAULT_CURRENCY,
      CheckInDate: params.checkInDate,
      CheckOutDate: params.checkOutDate,
      Rooms: {
        Room: rooms, // Must always be an array
      },
      TassProInfo: {
        CustomerCode: params.customerCode ?? AORYX_TASSPRO_CUSTOMER_CODE,
        RegionID: params.regionId ?? AORYX_TASSPRO_REGION_ID,
      },
    },
  };
}

// Extract session ID from response
function extractSessionId(generalInfo?: { sessionId?: string | null }): string {
  const sessionId = toStringValue(generalInfo?.sessionId);
  if (!sessionId) {
    throw new AoryxServiceError("No session ID in search response", "MISSING_SESSION_ID");
  }
  return sessionId;
}

// Validate search params
function validateSearchParams(params: AoryxSearchParams): void {
  if (!params.destinationCode && !params.hotelCode) {
    throw new AoryxServiceError("Either destinationCode or hotelCode is required", "INVALID_PARAMS");
  }
  if (!params.checkInDate || !params.checkOutDate) {
    throw new AoryxServiceError("Check-in and check-out dates are required", "INVALID_PARAMS");
  }
  if (!params.rooms || params.rooms.length === 0) {
    throw new AoryxServiceError("At least one room is required", "INVALID_PARAMS");
  }
}

// Service functions

/**
 * Search for hotels
 */
export async function search(params: AoryxSearchParams): Promise<AoryxSearchResult> {
  validateSearchParams(params);
  const request = buildSearchRequest(params);

  const response = await coreRequest<AoryxSearchRequest, AoryxSearchResponse>(
    DISTRIBUTION_ENDPOINTS.search,
    request,
    { timeoutMs: 60000 } // Search can take longer
  );

  if (!response.isSuccess && response.exceptionMessage) {
    throw new AoryxServiceError(
      response.exceptionMessage,
      "SEARCH_ERROR",
      response.statusCode ?? undefined,
      response.errors
    );
  }

  const sessionId = extractSessionId(response.generalInfo ?? undefined);
  const currency = toStringValue(response.monetary?.currency?.code);
  const hotelsRaw = response.hotels?.hotel ?? [];
  const hotelsArray = Array.isArray(hotelsRaw) ? hotelsRaw : hotelsRaw ? [hotelsRaw] : [];
  const hotels = hotelsArray.map((h) => normalizeSearchHotel(h, currency));

  return {
    sessionId,
    currency,
    propertyCount: toInteger(response.audit?.propertyCount),
    responseTime: toStringValue(response.audit?.responseTime),
    destination: response.audit?.destination
      ? {
          code: toStringValue(response.audit.destination.code),
          name: toStringValue(response.audit.destination.name),
        }
      : null,
    hotels,
  };
}

/**
 * Get hotels info by destination ID
 */
export async function hotelsInfoByDestinationId(destinationId: string): Promise<HotelInfo[]> {
  const request: AoryxHotelsInfoByDestinationIdRequest = { destinationId };

  const response = await coreRequest<
    AoryxHotelsInfoByDestinationIdRequest,
    AoryxHotelsInfoByDestinationIdResponse
  >(STATIC_ENDPOINTS.hotelsInfoByDestinationId, request);

  if (!response.isSuccess) {
    throw new AoryxServiceError(
      response.exceptionMessage ?? "HotelsInfoByDestinationId request failed",
      "HOTELS_INFO_ERROR",
      response.statusCode ?? undefined,
      response.errors
    );
  }

  return (response.hotelsInformation ?? []).map((item) => ({
    destinationId: toStringValue(item.destinationId),
    name: toStringValue(item.name),
    systemId: toStringValue(item.systemId),
    rating: toNumber(item.rating),
    city: toStringValue(item.city),
    address: toStringValue(item.address1),
    imageUrl: toStringValue(item.imageUrl),
    latitude: toNumber(item.geoCode?.lat),
    longitude: toNumber(item.geoCode?.lon),
  }));
}

/**
 * Normalize parent destination ID (ensures format like "160-0")
 */
export function normalizeParentDestinationId(rawId?: string): string | null {
  if (!rawId) return null;
  const trimmed = rawId.trim();
  if (!trimmed) return null;

  // If already has format "XXX-Y", return as is
  if (trimmed.includes("-")) {
    return trimmed;
  }

  // Otherwise, append "-0"
  return `${trimmed}-0`;
}

// Export the client object for easy access
export const aoryxClient = {
  search,
  hotelsInfoByDestinationId,
  normalizeParentDestinationId,
};
