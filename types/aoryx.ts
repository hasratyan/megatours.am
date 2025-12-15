// Aoryx API Types

// Room search configuration
export interface AoryxRoomSearch {
  roomIdentifier: number;
  adults: number;
  childrenAges: number[];
}

// Search parameters (frontend-friendly format)
export interface AoryxSearchParams {
  destinationCode?: string;
  hotelCode?: string;
  countryCode: string;
  nationality: string;
  checkInDate: string;
  checkOutDate: string;
  currency?: string;
  regionId?: string;
  customerCode?: string;
  rooms: AoryxRoomSearch[];
}

// Room occupancy for API request
export interface AoryxChildAge {
  Identifier: number;
  Text: string;
}

export interface AoryxRoomChildren {
  Count: number;
  ChildAge: AoryxChildAge[];
}

export interface AoryxRoomOccupancy {
  RoomIdentifier: number;
  Adult: number; // API uses "Adult" (singular)
  Children?: AoryxRoomChildren; // Optional children with Count and ChildAge array
}

// API Request types
export interface AoryxSearchParameter {
  DestinationCode?: string;
  HotelCode?: string;
  CountryCode: string;
  Nationality: string;
  Currency: string;
  CheckInDate: string;
  CheckOutDate: string;
  Rooms: {
    Room: AoryxRoomOccupancy[]; // Must always be an array
  };
  TassProInfo?: {
    CustomerCode?: string;
    RegionID?: string;
  };
}

export interface AoryxSearchRequest {
  GeneralInfo?: {
    ApiKey?: string;
    CustomerCode?: string;
  };
  SearchParameter: AoryxSearchParameter;
}

// Hotel info types (API response uses camelCase)
export interface AoryxHotelsInfoItem {
  destinationId?: string | null;
  name?: string | null;
  systemId?: string | null;
  rating?: number | null;
  city?: string | null;
  address1?: string | null;
  imageUrl?: string | null;
  geoCode?: {
    lat?: number | null;
    lon?: number | null;
  } | null;
  [key: string]: unknown;
}

export interface AoryxHotelsInfoByDestinationIdRequest {
  destinationId: string;
}

export interface AoryxHotelsInfoByDestinationIdResponse {
  isSuccess?: boolean;
  statusCode?: number;
  exceptionMessage?: string | null;
  errors?: unknown;
  hotelsInformation?: AoryxHotelsInfoItem[] | null;
  [key: string]: unknown;
}

// Search response types (API response uses camelCase)
export interface AoryxSearchHotelInfo {
  code?: string | null;
  spHotelCode?: string | null;
  name?: string | null;
  image?: string | null;
  description?: string | null;
  starRating?: string | null;
  lat?: string | null;
  lon?: string | null;
  add1?: string | null;
  add2?: string | null;
  city?: string | null;
  location?: string | null;
  hotelRemarks?: string | null;
  checkinInstruction?: string | null;
  checkOutInstruction?: string | null;
}

export interface AoryxSearchHotel {
  code?: string | null;
  name?: string | null;
  groupCode?: number | null;
  supplierGroupCode?: number | null;
  supplierShortCode?: string | null;
  minPrice?: number | null;
  supplierMinPrice?: number | null;
  supplierCurrency?: string | null;
  hotelInfo?: AoryxSearchHotelInfo | null;
  rooms?: unknown;
}

export interface AoryxSearchResponse {
  generalInfo?: {
    sessionId?: string | null;
    [key: string]: unknown;
  };
  monetary?: {
    currency?: {
      code?: string | null;
    };
  };
  audit?: {
    propertyCount?: number | null;
    responseTime?: string | null;
    destination?: {
      code?: string | null;
      name?: string | null;
    } | null;
  };
  hotels?: {
    hotel?: AoryxSearchHotel | AoryxSearchHotel[];
  };
  isSuccess?: boolean;
  statusCode?: number;
  exceptionMessage?: string | null;
  errors?: unknown;
  [key: string]: unknown;
}

// Normalized result types (for frontend)
export interface AoryxHotelSummary {
  code: string | null;
  name: string | null;
  minPrice: number | null;
  currency: string | null;
  rating: number | null;
  address: string | null;
  city: string | null;
  imageUrl: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface AoryxSearchResult {
  sessionId: string;
  currency: string | null;
  propertyCount: number | null;
  responseTime: string | null;
  destination: {
    code: string | null;
    name: string | null;
  } | null;
  hotels: AoryxHotelSummary[];
}

// Hotel info normalized
export interface HotelInfo {
  destinationId: string | null;
  name: string | null;
  systemId: string | null;
  rating: number | null;
  city: string | null;
  address: string | null;
  imageUrl: string | null;
  latitude: number | null;
  longitude: number | null;
}
