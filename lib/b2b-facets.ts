import type { AoryxExcursionTicket, AoryxRoomOption, AoryxTransferRate } from "@/types/aoryx";

type FacetItem = {
  key: string;
  label: string;
  count: number;
};

const normalizeText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeKey = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const toNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const addFacet = (map: Map<string, FacetItem>, label: string | null) => {
  if (!label) return;
  const key = normalizeKey(label);
  if (!key) return;
  const current = map.get(key);
  if (current) {
    current.count += 1;
    return;
  }
  map.set(key, { key, label, count: 1 });
};

const sortFacetItems = (items: FacetItem[]) =>
  items.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.label.localeCompare(b.label);
  });

const resolveRoomPrice = (room: AoryxRoomOption): number | null => {
  const display = toNumber(room.displayTotalPrice);
  if (display !== null) return display;
  const total = toNumber(room.totalPrice);
  if (total !== null) return total;
  const net = toNumber(room.price?.net);
  if (net !== null) return net;
  const gross = toNumber(room.price?.gross);
  if (gross !== null) return gross;
  return null;
};

export type RoomFacets = {
  mealPlans: FacetItem[];
  cancellationPolicies: FacetItem[];
  rateTypes: FacetItem[];
  refundability: {
    refundable: number;
    nonRefundable: number;
    unknown: number;
  };
  priceRange: {
    min: number | null;
    max: number | null;
    currency: string | null;
  };
};

export const buildRoomFacets = (rooms: AoryxRoomOption[], currency: string | null): RoomFacets => {
  const mealPlans = new Map<string, FacetItem>();
  const cancellationPolicies = new Map<string, FacetItem>();
  const rateTypes = new Map<string, FacetItem>();
  let refundable = 0;
  let nonRefundable = 0;
  let unknown = 0;
  let min: number | null = null;
  let max: number | null = null;

  for (const room of rooms) {
    addFacet(mealPlans, normalizeText(room.meal ?? room.boardType ?? null));
    addFacet(cancellationPolicies, normalizeText(room.cancellationPolicy ?? null));
    addFacet(rateTypes, normalizeText(room.rateType ?? null));

    if (room.refundable === true) {
      refundable += 1;
    } else if (room.refundable === false) {
      nonRefundable += 1;
    } else {
      unknown += 1;
    }

    const price = resolveRoomPrice(room);
    if (price === null) continue;
    min = min === null ? price : Math.min(min, price);
    max = max === null ? price : Math.max(max, price);
  }

  return {
    mealPlans: sortFacetItems(Array.from(mealPlans.values())),
    cancellationPolicies: sortFacetItems(Array.from(cancellationPolicies.values())),
    rateTypes: sortFacetItems(Array.from(rateTypes.values())),
    refundability: {
      refundable,
      nonRefundable,
      unknown,
    },
    priceRange: {
      min,
      max,
      currency,
    },
  };
};

export type TransferFacets = {
  transferTypes: FacetItem[];
  chargeTypes: FacetItem[];
  vehicleCategories: FacetItem[];
  priceRange: {
    minOneWay: number | null;
    maxOneWay: number | null;
    currency: string | null;
  };
};

export const buildTransferFacets = (transfers: AoryxTransferRate[]): TransferFacets => {
  const transferTypes = new Map<string, FacetItem>();
  const chargeTypes = new Map<string, FacetItem>();
  const vehicleCategories = new Map<string, FacetItem>();
  let minOneWay: number | null = null;
  let maxOneWay: number | null = null;
  let currency: string | null = null;

  for (const transfer of transfers) {
    addFacet(transferTypes, normalizeText(transfer.transferType ?? null));
    addFacet(chargeTypes, normalizeText(transfer.pricing?.chargeType ?? null));
    addFacet(
      vehicleCategories,
      normalizeText(transfer.vehicle?.category ?? transfer.vehicle?.name ?? null)
    );

    const oneWay = toNumber(transfer.pricing?.oneWay);
    if (oneWay !== null) {
      minOneWay = minOneWay === null ? oneWay : Math.min(minOneWay, oneWay);
      maxOneWay = maxOneWay === null ? oneWay : Math.max(maxOneWay, oneWay);
    }
    if (!currency) {
      currency = normalizeText(transfer.pricing?.currency ?? null);
    }
  }

  return {
    transferTypes: sortFacetItems(Array.from(transferTypes.values())),
    chargeTypes: sortFacetItems(Array.from(chargeTypes.values())),
    vehicleCategories: sortFacetItems(Array.from(vehicleCategories.values())),
    priceRange: {
      minOneWay,
      maxOneWay,
      currency,
    },
  };
};

export type ExcursionFacets = {
  productTypes: FacetItem[];
  cities: FacetItem[];
  priceRange: {
    minAdult: number | null;
    maxAdult: number | null;
    currency: string | null;
  };
};

export const buildExcursionFacets = (excursions: AoryxExcursionTicket[]): ExcursionFacets => {
  const productTypes = new Map<string, FacetItem>();
  const cities = new Map<string, FacetItem>();
  let minAdult: number | null = null;
  let maxAdult: number | null = null;
  let currency: string | null = null;

  for (const excursion of excursions) {
    addFacet(productTypes, normalizeText(excursion.productType ?? null));
    addFacet(cities, normalizeText(excursion.cityCode ?? null));

    const adult = toNumber(excursion.pricing?.adult);
    if (adult !== null) {
      minAdult = minAdult === null ? adult : Math.min(minAdult, adult);
      maxAdult = maxAdult === null ? adult : Math.max(maxAdult, adult);
    }
    if (!currency) {
      currency = normalizeText(excursion.pricing?.currency ?? null);
    }
  }

  return {
    productTypes: sortFacetItems(Array.from(productTypes.values())),
    cities: sortFacetItems(Array.from(cities.values())),
    priceRange: {
      minAdult,
      maxAdult,
      currency,
    },
  };
};

