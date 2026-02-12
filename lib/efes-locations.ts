import type { Locale } from "@/lib/i18n";
import { toCountryAlpha2, toCountryAlpha3 } from "@/lib/country-alpha3";

export type EfesLocationOption = {
  code: string;
  label: string;
};

export type EfesCountryOption = EfesLocationOption & {
  alpha2: string | null;
  flag: string;
};

export type EfesCountry = {
  id: string;
  alpha2: string | null;
  alpha3: string | null;
  raw: Record<string, unknown>;
};

export type EfesCountryLocation = {
  id: string;
  countryId: string;
  typeId: string | null;
  parentId: string | null;
  raw: Record<string, unknown>;
};

// Backward-compatible aliases used by existing checkout code.
export type EfesRaState = EfesCountryLocation;
export type EfesRaCityVillage = EfesCountryLocation;

export const EFES_DEFAULT_COUNTRY_ID = "1";
export const EFES_DEFAULT_REGION_ID = "2";

const EFES_VALUE_SET_URL = "/api/efes/value-set";
const FLAG_OFFSET = 127397;

const COUNTRY_LABEL_KEYS: Record<Locale, string[]> = {
  hy: ["country", "country_HY", "country_AM"],
  en: ["country_EN", "country_en", "country"],
  ru: ["country_RU", "country_ru", "country"],
};

const LOCATION_LABEL_KEYS: Record<Locale, string[]> = {
  hy: ["location_name", "location_name_HY", "location_name_AM"],
  en: ["location_name_EN", "location_name_en", "location_name"],
  ru: ["location_name_RU", "location_name_ru", "location_name"],
};

let countriesCache: EfesCountry[] | null = null;
let countriesPromise: Promise<EfesCountry[]> | null = null;
let allLocationsCache: EfesCountryLocation[] | null = null;
let allLocationsPromise: Promise<EfesCountryLocation[]> | null = null;
const locationsByCountryCache: Record<string, EfesCountryLocation[] | undefined> = {};
const locationsByCountryPromise: Record<string, Promise<EfesCountryLocation[]> | undefined> = {};

const readString = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toFlagEmoji = (code: string | null | undefined) => {
  const normalized = code?.trim().toUpperCase();
  if (!normalized || normalized.length !== 2) return "🏳";
  return normalized.replace(/[A-Z]/g, (char) =>
    String.fromCodePoint(FLAG_OFFSET + char.charCodeAt(0))
  );
};

const normalizeEfesList = (payload: unknown): Record<string, unknown>[] => {
  if (Array.isArray(payload)) {
    return payload.filter(
      (item): item is Record<string, unknown> => Boolean(item && typeof item === "object")
    );
  }
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  const candidates = ["data", "items", "results", "list"];
  for (const key of candidates) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value.filter(
        (item): item is Record<string, unknown> => Boolean(item && typeof item === "object")
      );
    }
  }
  if (record.data && typeof record.data === "object") {
    return normalizeEfesList(record.data);
  }
  return [];
};

const resolveLocalizedLabel = (
  record: Record<string, unknown>,
  locale: Locale,
  keyMap: Record<Locale, string[]>
) => {
  const localeKeys = keyMap[locale] ?? [];
  for (const key of localeKeys) {
    const value = readString(record[key]);
    if (value) return value;
  }
  const fallbackLocales: Locale[] = ["en", "ru", "hy"];
  for (const fallbackLocale of fallbackLocales) {
    if (fallbackLocale === locale) continue;
    for (const key of keyMap[fallbackLocale] ?? []) {
      const value = readString(record[key]);
      if (value) return value;
    }
  }
  return null;
};

const resolveCountryLabel = (record: Record<string, unknown>, locale: Locale) =>
  resolveLocalizedLabel(record, locale, COUNTRY_LABEL_KEYS);

const resolveLocationLabel = (record: Record<string, unknown>, locale: Locale) =>
  resolveLocalizedLabel(record, locale, LOCATION_LABEL_KEYS);

const parseEfesCountries = (payload: unknown): EfesCountry[] => {
  const list = normalizeEfesList(payload);
  const seen = new Set<string>();
  const options: EfesCountry[] = [];
  list.forEach((record) => {
    const id =
      readString(record.country_id) ??
      readString(record.countryId) ??
      readString(record.id) ??
      null;
    if (!id || seen.has(id)) return;
    const hidden = readString(record.hidden) === "1" || readString(record.adr_hidden) === "1";
    if (hidden) return;
    const abbreviation = readString(record.country_abbreviation)?.toUpperCase() ?? null;
    const alpha2 = abbreviation && abbreviation.length === 2 ? abbreviation : null;
    const rawIso = readString(record.country_iso_code)?.toUpperCase() ?? null;
    const alpha3 =
      rawIso && rawIso.length === 3
        ? rawIso
        : toCountryAlpha3(alpha2) ?? toCountryAlpha3(readString(record.country_label));
    seen.add(id);
    options.push({
      id,
      alpha2,
      alpha3,
      raw: record,
    });
  });
  return options;
};

const parseEfesCountryLocations = (payload: unknown): EfesCountryLocation[] => {
  const list = normalizeEfesList(payload);
  const seen = new Set<string>();
  const locations: EfesCountryLocation[] = [];
  list.forEach((record) => {
    const id =
      readString(record.location_id) ??
      readString(record.locationId) ??
      readString(record.id) ??
      null;
    const countryId =
      readString(record.country_id) ??
      readString(record.countryId) ??
      null;
    if (!id || !countryId) return;
    const dedupeKey = `${countryId}:${id}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    locations.push({
      id,
      countryId,
      typeId: readString(record.location_type_id) ?? readString(record.locationTypeId) ?? null,
      parentId: readString(record.parent_id) ?? readString(record.parentId) ?? null,
      raw: record,
    });
  });
  return locations;
};

const fetchEfesValueSet = async (dicName: string): Promise<unknown> => {
  const response = await fetch(EFES_VALUE_SET_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dicName }),
  });
  if (!response.ok) {
    throw new Error(`EFES value set request failed: ${response.status}`);
  }
  return response.json();
};

const fetchAllEfesCountryLocations = async () => {
  if (allLocationsCache) return allLocationsCache;
  if (allLocationsPromise) return allLocationsPromise;
  allLocationsPromise = fetchEfesValueSet("dic_country_locations")
    .then((payload) => {
      const locations = parseEfesCountryLocations(payload);
      allLocationsCache = locations;
      return locations;
    })
    .finally(() => {
      allLocationsPromise = null;
    });
  return allLocationsPromise;
};

export const fetchEfesCountries = async (): Promise<EfesCountry[]> => {
  if (countriesCache) return countriesCache;
  if (countriesPromise) return countriesPromise;
  countriesPromise = fetchEfesValueSet("dic_countries")
    .then(async (payload) => {
      const fromCountries = parseEfesCountries(payload);
      if (fromCountries.length > 0) {
        countriesCache = fromCountries;
        return fromCountries;
      }
      // Fallback for unexpected EFES dictionary setups.
      const locationsPayload = await fetchEfesValueSet("dic_country_locations");
      const fallbackCountries = parseEfesCountries(locationsPayload);
      countriesCache = fallbackCountries;
      return fallbackCountries;
    })
    .finally(() => {
      countriesPromise = null;
    });
  return countriesPromise;
};

export const fetchEfesCountryLocations = async (
  countryId: string
): Promise<EfesCountryLocation[]> => {
  const normalizedCountryId = countryId.trim();
  if (!normalizedCountryId) return [];
  if (locationsByCountryCache[normalizedCountryId]) {
    return locationsByCountryCache[normalizedCountryId] ?? [];
  }
  if (locationsByCountryPromise[normalizedCountryId]) {
    return locationsByCountryPromise[normalizedCountryId] ?? [];
  }
  locationsByCountryPromise[normalizedCountryId] = fetchAllEfesCountryLocations()
    .then((allLocations) => {
      const filtered = allLocations.filter(
        (location) => location.countryId === normalizedCountryId
      );
      locationsByCountryCache[normalizedCountryId] = filtered;
      return filtered;
    })
    .finally(() => {
      locationsByCountryPromise[normalizedCountryId] = undefined;
    });
  return locationsByCountryPromise[normalizedCountryId] ?? [];
};

export const getEfesCountryOptions = (
  locale: Locale,
  countries?: EfesCountry[]
): EfesCountryOption[] => {
  const entries = countries ?? [];
  return entries
    .map((country) => {
      const alpha2 =
        country.alpha2 ??
        toCountryAlpha2(country.alpha3) ??
        toCountryAlpha2(readString(country.raw.country_iso_code));
      return {
        option: {
          code: country.id,
          label: resolveCountryLabel(country.raw, locale) ?? country.id,
          alpha2,
          flag: toFlagEmoji(alpha2),
        },
        orderBy: Number.parseInt(readString(country.raw.order_by) ?? "999999", 10),
      };
    })
    .sort((a, b) => {
      const aIsArmenia =
        a.option.alpha2?.toUpperCase() === "AM" ||
        a.option.code === EFES_DEFAULT_COUNTRY_ID;
      const bIsArmenia =
        b.option.alpha2?.toUpperCase() === "AM" ||
        b.option.code === EFES_DEFAULT_COUNTRY_ID;
      if (aIsArmenia !== bIsArmenia) {
        return aIsArmenia ? -1 : 1;
      }
      if (Number.isFinite(a.orderBy) && Number.isFinite(b.orderBy) && a.orderBy !== b.orderBy) {
        return a.orderBy - b.orderBy;
      }
      return a.option.label.localeCompare(b.option.label, locale, { sensitivity: "base" });
    })
    .map((entry) => entry.option);
};

const dedupeAndSort = (entries: EfesLocationOption[], locale: Locale) => {
  const unique = new Map<string, EfesLocationOption>();
  entries.forEach((entry) => {
    if (!unique.has(entry.code)) unique.set(entry.code, entry);
  });
  return Array.from(unique.values()).sort((a, b) =>
    a.label.localeCompare(b.label, locale, { sensitivity: "base" })
  );
};

export const getEfesRegionOptions = (
  countryId: string | null | undefined,
  locale: Locale,
  locationsByCountry?: Record<string, EfesCountryLocation[]>
) => {
  const normalizedCountryId = countryId?.trim();
  if (!normalizedCountryId) return [];
  const locations = locationsByCountry?.[normalizedCountryId] ?? [];
  const regions = locations
    .filter((location) => {
      const parentId = location.parentId ?? "";
      const locationType = location.typeId ?? "";
      if (location.id === parentId) return false;
      return parentId === "0" || locationType === "1";
    })
    .map((location) => ({
      code: location.id,
      label: resolveLocationLabel(location.raw, locale) ?? location.id,
    }));
  return dedupeAndSort(regions, locale);
};

export const getEfesCityOptions = (
  countryId: string | null | undefined,
  regionCode: string | null | undefined,
  locale: Locale,
  locationsByCountry?: Record<string, EfesCountryLocation[]>
) => {
  const normalizedCountryId = countryId?.trim();
  const normalizedRegionCode = regionCode?.trim();
  if (!normalizedCountryId || !normalizedRegionCode) return [];
  const locations = locationsByCountry?.[normalizedCountryId] ?? [];
  const cities = locations
    .filter((location) => {
      const parentId = location.parentId ?? "";
      if (location.id === parentId) return false;
      return parentId === normalizedRegionCode;
    })
    .map((location) => ({
      code: location.id,
      label: resolveLocationLabel(location.raw, locale) ?? location.id,
    }));
  return dedupeAndSort(cities, locale);
};

// Backward-compatible wrappers for old Armenia-only API usage.
export const fetchEfesRaStates = async (): Promise<EfesRaState[]> => {
  const locations = await fetchEfesCountryLocations(EFES_DEFAULT_COUNTRY_ID);
  return locations.filter(
    (location) => location.parentId === "0" && (location.typeId === "1" || location.typeId === null)
  );
};

export const fetchEfesRaCityVillages = async (
  stateId: string
): Promise<EfesRaCityVillage[]> => {
  const normalized = stateId.trim();
  if (!normalized) return [];
  const locations = await fetchEfesCountryLocations(EFES_DEFAULT_COUNTRY_ID);
  return locations.filter((location) => location.parentId === normalized && location.id !== normalized);
};
