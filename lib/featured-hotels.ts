import type { Collection, Filter, ObjectId, Sort } from "mongodb";
import { unstable_cache } from "next/cache";
import type { Locale } from "@/lib/i18n";
import { getB2bDb, getDb } from "@/lib/db";

export type FeaturedHotelTranslation = {
  badge: string;
  availability: string;
};

export type FeaturedHotelSelection = {
  hotelCode: string;
  priceFrom: number;
  oldPrice: number;
  currency: string;
  amenities: string[];
  translations: Record<Locale, FeaturedHotelTranslation>;
  createdAt?: Date;
  updatedAt?: Date;
};

export type FeaturedHotelCard = {
  id: string;
  hotelCode: string;
  name: string;
  location: string;
  rating: number;
  image: string;
  perks: string[];
  priceFrom: number;
  oldPrice: number | null;
  currency: string;
  badge: string | null;
  availability: string | null;
};

export type FeaturedHotelAdminItem = {
  hotelCode: string;
  name: string | null;
  destinationName: string | null;
  rating: number | null;
  imageUrl: string | null;
  availableAmenities: string[];
  selectedAmenities: string[];
  priceFrom: number | null;
  oldPrice: number | null;
  currency: string | null;
  translations: Record<Locale, FeaturedHotelTranslation>;
  createdAt: string | null;
  updatedAt: string | null;
};

export type AoryxHotelOption = {
  hotelCode: string;
  name: string | null;
  destinationName: string | null;
  rating: number | null;
  imageUrl: string | null;
  masterHotelAmenities: string[];
};

type AoryxHotelDoc = Record<string, unknown> & { _id: string | number | ObjectId };

type NormalizedAoryxHotel = {
  hotelCode: string;
  name: string | null;
  destinationName: string | null;
  rating: number | null;
  imageUrl: string | null;
  masterHotelAmenities: string[];
};

export const FEATURED_HOTELS_CACHE_TAG = "featured-hotels";
const AORYX_HOTELS_COLLECTION = "aoryx_hotels";
const MIN_ADMIN_SEARCH_CANDIDATES = 800;
const MAX_ADMIN_SEARCH_CANDIDATES = 6000;
let adminSearchIndexesEnsured = false;

const toStringValue = (value: unknown): string | null => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number") return `${value}`;
  return null;
};

const toNumberValue = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const normalizeSearchText = (value: string): string =>
  value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .toLowerCase()
    .trim();

const readString = (record: AoryxHotelDoc, keys: string[]): string | null => {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      const value = toStringValue(record[key]);
      if (value) return value;
    }
  }
  return null;
};

const readNumber = (record: AoryxHotelDoc, keys: string[]): number | null => {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      const value = toNumberValue(record[key]);
      if (value !== null) return value;
    }
  }
  return null;
};

const readStringArray = (record: AoryxHotelDoc, keys: string[]): string[] => {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
    const value = record[key];
    if (Array.isArray(value)) {
      return value.map(toStringValue).filter((item): item is string => Boolean(item));
    }
  }
  return [];
};

const normalizeAoryxHotelDoc = (record: AoryxHotelDoc): NormalizedAoryxHotel | null => {
  const hotelCode = readString(record, [
    "systemId",
    "SystemId",
    "hotelCode",
    "HotelCode",
    "code",
    "Code",
    "id",
    "_id",
  ]);
  if (!hotelCode) return null;

  return {
    hotelCode,
    name: readString(record, ["name", "Name", "hotelName", "HotelName"]),
    destinationName: readString(record, ["destinationName", "DestinationName", "city", "City"]),
    rating: readNumber(record, ["rating", "Rating", "starRating", "StarRating", "tripAdvisorRating", "TripAdvisorRating"]),
    imageUrl: readString(record, ["imageUrl", "ImageUrl", "image", "Image", "primaryImage", "PrimaryImage"]),
    masterHotelAmenities: readStringArray(record, [
      "masterHotelAmenities",
      "MasterHotelAmenities",
      "hotelAmenities",
      "HotelAmenities",
      "amenities",
      "Amenities",
    ]),
  };
};

const serializeDate = (value?: Date | string | null): string | null => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const buildTranslationFallback = (): Record<Locale, FeaturedHotelTranslation> => ({
  hy: { badge: "", availability: "" },
  en: { badge: "", availability: "" },
  ru: { badge: "", availability: "" },
});

const AORYX_ADMIN_SEARCH_PROJECTION = {
  _id: 1,
  systemId: 1,
  SystemId: 1,
  hotelCode: 1,
  HotelCode: 1,
  code: 1,
  Code: 1,
  id: 1,
  name: 1,
  Name: 1,
  hotelName: 1,
  HotelName: 1,
  destinationName: 1,
  DestinationName: 1,
  city: 1,
  City: 1,
  rating: 1,
  Rating: 1,
  starRating: 1,
  StarRating: 1,
  tripAdvisorRating: 1,
  TripAdvisorRating: 1,
  imageUrl: 1,
  ImageUrl: 1,
  image: 1,
  Image: 1,
  primaryImage: 1,
  PrimaryImage: 1,
  masterHotelAmenities: 1,
  MasterHotelAmenities: 1,
  hotelAmenities: 1,
  HotelAmenities: 1,
  amenities: 1,
  Amenities: 1,
};

const AORYX_ADMIN_DEFAULT_SORT: Sort = {
  rating: -1,
  Rating: -1,
  name: 1,
  Name: 1,
  hotelCode: 1,
  HotelCode: 1,
  systemId: 1,
  SystemId: 1,
};

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getAdminSearchCandidateLimit = (safeLimit: number) =>
  Math.min(
    Math.max(safeLimit * 20, MIN_ADMIN_SEARCH_CANDIDATES),
    MAX_ADMIN_SEARCH_CANDIDATES
  );

const buildTokenFilter = (token: string): Filter<AoryxHotelDoc> => {
  const escapedToken = escapeRegex(token);
  const codeRegex = new RegExp(`^${escapedToken}`, "i");
  const textRegex = new RegExp(escapedToken, "i");
  return {
    $or: [
      { systemId: { $regex: codeRegex } },
      { SystemId: { $regex: codeRegex } },
      { hotelCode: { $regex: codeRegex } },
      { HotelCode: { $regex: codeRegex } },
      { code: { $regex: codeRegex } },
      { Code: { $regex: codeRegex } },
      { id: { $regex: codeRegex } },
      { name: { $regex: textRegex } },
      { Name: { $regex: textRegex } },
      { hotelName: { $regex: textRegex } },
      { HotelName: { $regex: textRegex } },
      { destinationName: { $regex: textRegex } },
      { DestinationName: { $regex: textRegex } },
      { city: { $regex: textRegex } },
      { City: { $regex: textRegex } },
    ],
  };
};

const buildAdminSearchFilter = (queryTokens: string[]): Filter<AoryxHotelDoc> => {
  if (queryTokens.length === 0) return {};
  return {
    $and: queryTokens.map((token) => buildTokenFilter(token)),
  };
};

const ensureAdminSearchIndexes = async (collection: Collection<AoryxHotelDoc>) => {
  if (adminSearchIndexesEnsured) return;
  adminSearchIndexesEnsured = true;
  try {
    await collection.createIndexes([
      { key: { systemId: 1 }, name: "aoryx_hotels_systemId_1" },
      { key: { SystemId: 1 }, name: "aoryx_hotels_SystemId_1" },
      { key: { hotelCode: 1 }, name: "aoryx_hotels_hotelCode_1" },
      { key: { HotelCode: 1 }, name: "aoryx_hotels_HotelCode_1" },
      { key: { name: 1 }, name: "aoryx_hotels_name_1" },
      { key: { Name: 1 }, name: "aoryx_hotels_Name_1" },
      { key: { destinationName: 1 }, name: "aoryx_hotels_destinationName_1" },
      { key: { DestinationName: 1 }, name: "aoryx_hotels_DestinationName_1" },
      { key: { rating: -1 }, name: "aoryx_hotels_rating_desc" },
      { key: { Rating: -1 }, name: "aoryx_hotels_Rating_desc" },
    ]);
  } catch (error) {
    console.warn("[AdminHotels] Failed to ensure search indexes", error);
  }
};

const loadAdminSearchCandidates = async (queryTokens: string[], safeLimit: number) => {
  const db = await getB2bDb();
  const collection = db.collection<AoryxHotelDoc>(AORYX_HOTELS_COLLECTION);
  await ensureAdminSearchIndexes(collection);

  const filter = buildAdminSearchFilter(queryTokens);
  const candidateLimit = getAdminSearchCandidateLimit(safeLimit);
  const cursor = collection.find(filter, { projection: AORYX_ADMIN_SEARCH_PROJECTION }).limit(candidateLimit);

  if (queryTokens.length === 0) {
    cursor.sort(AORYX_ADMIN_DEFAULT_SORT);
  }

  return cursor.toArray();
};

export async function searchAoryxHotels(query: string, limit = 40): Promise<AoryxHotelOption[]> {
  const normalizedQuery = normalizeSearchText(query.trim());
  const queryTokens = normalizedQuery.split(/\s+/).filter((token) => token.length > 0);
  const safeLimit = Math.max(limit, 1);
  const docs = await loadAdminSearchCandidates(queryTokens, safeLimit);

  const options = docs
    .map((doc) => normalizeAoryxHotelDoc(doc as AoryxHotelDoc))
    .filter((item): item is NormalizedAoryxHotel => Boolean(item));

  const filtered = queryTokens.length > 0
    ? options.filter((item) => {
        const searchTarget = normalizeSearchText(
          [
            item.name,
            item.destinationName,
            item.hotelCode,
          ]
            .filter(Boolean)
            .join(" ")
        );
        return queryTokens.every((token) => searchTarget.includes(token));
      })
    : options;

  if (queryTokens.length > 0) {
    filtered.sort((a, b) => {
      const aCode = normalizeSearchText(a.hotelCode);
      const bCode = normalizeSearchText(b.hotelCode);
      const aName = normalizeSearchText(a.name ?? "");
      const bName = normalizeSearchText(b.name ?? "");
      const aDestination = normalizeSearchText(a.destinationName ?? "");
      const bDestination = normalizeSearchText(b.destinationName ?? "");

      const scoreItem = (
        code: string,
        name: string,
        destination: string,
        rating: number | null,
        hasImage: boolean
      ) => {
        if (code === normalizedQuery || name === normalizedQuery || destination === normalizedQuery) {
          return 500;
        }
        if (name.startsWith(normalizedQuery) || destination.startsWith(normalizedQuery)) {
          return 400;
        }
        if (code.startsWith(normalizedQuery)) {
          return 350;
        }
        let score = 0;
        if (name.includes(normalizedQuery)) score += 200;
        if (destination.includes(normalizedQuery)) score += 180;
        if (code.includes(normalizedQuery)) score += 160;
        if (hasImage) score += 20;
        score += Math.max(rating ?? 0, 0);
        return score;
      };

      const scoreA = scoreItem(aCode, aName, aDestination, a.rating, Boolean(a.imageUrl));
      const scoreB = scoreItem(bCode, bName, bDestination, b.rating, Boolean(b.imageUrl));
      if (scoreA !== scoreB) return scoreB - scoreA;

      const ratingDiff = (b.rating ?? 0) - (a.rating ?? 0);
      if (ratingDiff !== 0) return ratingDiff;
      return (a.name ?? a.hotelCode).localeCompare(b.name ?? b.hotelCode);
    });

    return filtered.slice(0, safeLimit).map((item) => ({
      hotelCode: item.hotelCode,
      name: item.name ?? null,
      destinationName: item.destinationName ?? null,
      rating: item.rating ?? null,
      imageUrl: item.imageUrl ?? null,
      masterHotelAmenities: item.masterHotelAmenities,
    }));
  }

  const destinationGroups = new Map<string, NormalizedAoryxHotel[]>();
  for (const item of filtered) {
    const key = item.destinationName?.trim().toLowerCase() || "__unknown__";
    const existing = destinationGroups.get(key) ?? [];
    existing.push(item);
    destinationGroups.set(key, existing);
  }

  const sortedDestinations = Array.from(destinationGroups.keys()).sort((a, b) => {
    if (a === "__unknown__") return 1;
    if (b === "__unknown__") return -1;
    return a.localeCompare(b);
  });

  for (const hotels of destinationGroups.values()) {
    hotels.sort((a, b) => {
      const imageDiff = Number(Boolean(b.imageUrl)) - Number(Boolean(a.imageUrl));
      if (imageDiff !== 0) return imageDiff;
      const ratingDiff = (b.rating ?? 0) - (a.rating ?? 0);
      if (ratingDiff !== 0) return ratingDiff;
      return (a.name ?? a.hotelCode).localeCompare(b.name ?? b.hotelCode);
    });
  }

  const ranked: NormalizedAoryxHotel[] = [];
  while (ranked.length < safeLimit) {
    let pulled = false;
    for (const destination of sortedDestinations) {
      if (ranked.length >= safeLimit) break;
      const hotels = destinationGroups.get(destination);
      if (!hotels || hotels.length === 0) continue;
      const nextHotel = hotels.shift();
      if (!nextHotel) continue;
      ranked.push(nextHotel);
      pulled = true;
    }
    if (!pulled) break;
  }

  return ranked.map((item) => ({
    hotelCode: item.hotelCode,
    name: item.name ?? null,
    destinationName: item.destinationName ?? null,
    rating: item.rating ?? null,
    imageUrl: item.imageUrl ?? null,
    masterHotelAmenities: item.masterHotelAmenities,
  }));
}

export async function getFeaturedHotelSelections(): Promise<FeaturedHotelSelection[]> {
  const db = await getDb();
  const docs = await db.collection("home_featured_hotels").find({}).sort({ createdAt: 1 }).toArray();
  type TranslationSource = Record<string, { badge?: unknown; availability?: unknown } | undefined>;
  return docs.map((doc) => ({
    hotelCode: toStringValue(doc.hotelCode) ?? "",
    priceFrom: toNumberValue(doc.priceFrom) ?? 0,
    oldPrice: toNumberValue(doc.oldPrice) ?? 0,
    currency: toStringValue(doc.currency) ?? "$",
    amenities: Array.isArray(doc.amenities)
      ? doc.amenities.map(toStringValue).filter((item): item is string => Boolean(item))
      : [],
    translations: typeof doc.translations === "object" && doc.translations
      ? {
          hy: {
            badge: toStringValue((doc.translations as TranslationSource).hy?.badge) ?? "",
            availability: toStringValue((doc.translations as TranslationSource).hy?.availability) ?? "",
          },
          en: {
            badge: toStringValue((doc.translations as TranslationSource).en?.badge) ?? "",
            availability: toStringValue((doc.translations as TranslationSource).en?.availability) ?? "",
          },
          ru: {
            badge: toStringValue((doc.translations as TranslationSource).ru?.badge) ?? "",
            availability: toStringValue((doc.translations as TranslationSource).ru?.availability) ?? "",
          },
        }
      : buildTranslationFallback(),
    createdAt: doc.createdAt instanceof Date ? doc.createdAt : undefined,
    updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt : undefined,
  })).filter((entry) => entry.hotelCode.length > 0);
}

export async function getAoryxHotelsByCodes(hotelCodes: string[]): Promise<Map<string, NormalizedAoryxHotel>> {
  if (hotelCodes.length === 0) return new Map();
  const db = await getB2bDb();
  const numericCodes = hotelCodes
    .map((code) => Number(code))
    .filter((value) => Number.isFinite(value));
  const searchValues: Array<string | number> = [...hotelCodes, ...numericCodes];

  const docs = await db
    .collection<AoryxHotelDoc>(AORYX_HOTELS_COLLECTION)
    .find({
      $or: [
        { systemId: { $in: searchValues } },
        { SystemId: { $in: searchValues } },
        { hotelCode: { $in: searchValues } },
        { HotelCode: { $in: searchValues } },
        { code: { $in: searchValues } },
        { Code: { $in: searchValues } },
        { id: { $in: searchValues } },
        { _id: { $in: searchValues } },
      ],
    }, { projection: AORYX_ADMIN_SEARCH_PROJECTION })
    .toArray();

  const map = new Map<string, NormalizedAoryxHotel>();
  for (const doc of docs) {
    const normalized = normalizeAoryxHotelDoc(doc as AoryxHotelDoc);
    if (!normalized) continue;
    map.set(normalized.hotelCode, normalized);
  }
  return map;
}

const getFeaturedHotelCardsCached = unstable_cache(async (locale: Locale): Promise<FeaturedHotelCard[]> => {
  const selections = await getFeaturedHotelSelections();
  if (selections.length === 0) return [];
  const hotelMap = await getAoryxHotelsByCodes(selections.map((entry) => entry.hotelCode));
  const seen = new Set<string>();

  const cards: FeaturedHotelCard[] = [];
  selections.forEach((entry) => {
    if (seen.has(entry.hotelCode)) return;
    const hotel = hotelMap.get(entry.hotelCode);
    if (!hotel) return;
    const rating = hotel.rating ?? null;
    if (rating === null || rating < 4) return;
    if (!hotel.imageUrl) return;
    seen.add(entry.hotelCode);

    const translation = entry.translations?.[locale] ?? entry.translations?.en ?? entry.translations?.hy ?? entry.translations?.ru ?? null;
    const perks = entry.amenities.length > 0
      ? entry.amenities.slice(0, 3)
      : hotel.masterHotelAmenities.slice(0, 3);

    cards.push({
      id: entry.hotelCode,
      hotelCode: entry.hotelCode,
      name: hotel.name ?? "",
      location: hotel.destinationName ?? "",
      rating,
      image: hotel.imageUrl,
      perks,
      priceFrom: entry.priceFrom,
      oldPrice: entry.oldPrice ?? null,
      currency: entry.currency || "$",
      badge: translation?.badge ?? null,
      availability: translation?.availability ?? null,
    });
  });
  return cards;
}, ["featured-hotel-cards"], {
  tags: [FEATURED_HOTELS_CACHE_TAG],
  revalidate: 60 * 60,
});

export async function getFeaturedHotelCards(locale: Locale): Promise<FeaturedHotelCard[]> {
  return getFeaturedHotelCardsCached(locale);
}

export async function getFeaturedHotelAdminItems(): Promise<FeaturedHotelAdminItem[]> {
  const selections = await getFeaturedHotelSelections();
  const hotelMap = await getAoryxHotelsByCodes(selections.map((entry) => entry.hotelCode));
  return selections.map((entry) => {
    const hotel = hotelMap.get(entry.hotelCode);
    return {
      hotelCode: entry.hotelCode,
      name: hotel?.name ?? null,
      destinationName: hotel?.destinationName ?? null,
      rating: hotel?.rating ?? null,
      imageUrl: hotel?.imageUrl ?? null,
      availableAmenities: hotel?.masterHotelAmenities ?? [],
      selectedAmenities: entry.amenities ?? [],
      priceFrom: entry.priceFrom ?? null,
      oldPrice: entry.oldPrice ?? null,
      currency: entry.currency ?? null,
      translations: entry.translations ?? buildTranslationFallback(),
      createdAt: serializeDate(entry.createdAt),
      updatedAt: serializeDate(entry.updatedAt),
    };
  });
}
