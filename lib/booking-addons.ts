import { convertToAmd, normalizeCurrencyCode, type AmdRates } from "@/lib/currency";
import { getAmdRateForCurrency, getAmdRates } from "@/lib/pricing";
import type { AoryxBookingPayload, AoryxBookingResult } from "@/types/aoryx";

export type BookingAddonServiceKey = "transfer" | "excursion" | "insurance" | "flight";

export type BookingAddonServicesPayload = {
  transferSelection?: NonNullable<AoryxBookingPayload["transferSelection"]>;
  excursions?: NonNullable<AoryxBookingPayload["excursions"]>;
  insurance?: NonNullable<AoryxBookingPayload["insurance"]>;
  airTickets?: NonNullable<AoryxBookingPayload["airTickets"]>;
};

export type BookingAddonCheckoutRequest = {
  bookingId: string;
  services: BookingAddonServicesPayload;
  serviceKeys: BookingAddonServiceKey[];
};

export type BookingAddonAmdTotals = {
  totalAmd: number;
  breakdownAmd: {
    transfer: number;
    excursions: number;
    insurance: number;
    flights: number;
  };
};

const resolveString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const toNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const toBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "yes" || normalized === "1") return true;
    if (normalized === "false" || normalized === "no" || normalized === "0") return false;
  }
  return undefined;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const parseTransferSelection = (
  value: unknown
): NonNullable<AoryxBookingPayload["transferSelection"]> | undefined => {
  if (!isRecord(value)) return undefined;
  const totalPrice = toNumber(value.totalPrice);
  if (totalPrice === null || totalPrice <= 0) return undefined;

  const pricingRecord = isRecord(value.pricing) ? value.pricing : null;
  const transfer = {
    ...value,
    includeReturn: toBoolean(value.includeReturn),
    totalPrice,
    pricing: pricingRecord
      ? {
          ...pricingRecord,
          currency: resolveString(pricingRecord.currency) || undefined,
          chargeType: resolveString(pricingRecord.chargeType) || undefined,
          oneWay: toNumber(pricingRecord.oneWay),
          return: toNumber(pricingRecord.return),
        }
      : undefined,
  };

  return clone(transfer as NonNullable<AoryxBookingPayload["transferSelection"]>);
};

const parseExcursions = (
  value: unknown
): NonNullable<AoryxBookingPayload["excursions"]> | undefined => {
  if (!isRecord(value)) return undefined;
  const totalAmount = toNumber(value.totalAmount);
  const selectionsRaw = Array.isArray(value.selections) ? value.selections : [];
  const selections = selectionsRaw
    .map((entry) => {
      if (!isRecord(entry)) return null;
      const id = resolveString(entry.id);
      if (!id) return null;
      return {
        id,
        name: resolveString(entry.name) || undefined,
        quantityAdult: toNumber(entry.quantityAdult),
        quantityChild: toNumber(entry.quantityChild),
        priceAdult: toNumber(entry.priceAdult),
        priceChild: toNumber(entry.priceChild),
        currency: resolveString(entry.currency) || undefined,
        childPolicy: resolveString(entry.childPolicy) || undefined,
        totalPrice: toNumber(entry.totalPrice),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  if (selections.length === 0) return undefined;

  const normalizedTotal =
    totalAmount !== null && totalAmount > 0
      ? totalAmount
      : selections.reduce((sum, selection) => {
          if (typeof selection.totalPrice === "number" && Number.isFinite(selection.totalPrice)) {
            return sum + selection.totalPrice;
          }
          return sum;
        }, 0);

  if (!Number.isFinite(normalizedTotal) || normalizedTotal <= 0) return undefined;

  return {
    totalAmount: normalizedTotal,
    selections: clone(selections),
  };
};

const normalizeGender = (value: unknown): "M" | "F" | null => {
  const normalized = resolveString(value).toUpperCase();
  if (normalized === "M" || normalized === "MALE") return "M";
  if (normalized === "F" || normalized === "FEMALE") return "F";
  return null;
};

const parseInsurance = (
  value: unknown
): NonNullable<AoryxBookingPayload["insurance"]> | undefined => {
  if (!isRecord(value)) return undefined;
  const planId =
    resolveString(value.planId) ||
    resolveString((value as { selectionId?: unknown }).selectionId);
  const providerRaw = resolveString(value.provider).toLowerCase();
  const price = toNumber(value.price);
  const riskAmount = toNumber(value.riskAmount);
  const territoryCode = resolveString(value.territoryCode);
  const startDate = resolveString(value.startDate);
  const endDate = resolveString(value.endDate);

  const travelers = Array.isArray(value.travelers)
    ? value.travelers
        .map((entry) => {
          if (!isRecord(entry)) return null;
          const firstName = resolveString(entry.firstName);
          const lastName = resolveString(entry.lastName);
          if (!firstName || !lastName) return null;
          const residency = toBoolean(entry.residency);
          const addressRaw = isRecord(entry.address) ? entry.address : null;
          return {
            id: resolveString(entry.id) || null,
            firstName,
            lastName,
            firstNameEn: resolveString(entry.firstNameEn) || null,
            lastNameEn: resolveString(entry.lastNameEn) || null,
            gender: normalizeGender(entry.gender),
            birthDate: resolveString(entry.birthDate) || null,
            residency: residency === undefined ? null : Boolean(residency),
            socialCard: resolveString(entry.socialCard) || null,
            passportNumber: resolveString(entry.passportNumber) || null,
            passportAuthority: resolveString(entry.passportAuthority) || null,
            passportIssueDate: resolveString(entry.passportIssueDate) || null,
            passportExpiryDate: resolveString(entry.passportExpiryDate) || null,
            phone: resolveString(entry.phone) || null,
            mobilePhone: resolveString(entry.mobilePhone) || null,
            email: resolveString(entry.email) || null,
            address: addressRaw
              ? {
                  full: resolveString(addressRaw.full) || null,
                  fullEn: resolveString(addressRaw.fullEn) || null,
                  country: resolveString(addressRaw.country) || null,
                  countryId: resolveString(addressRaw.countryId) || null,
                  region: resolveString(addressRaw.region) || null,
                  city: resolveString(addressRaw.city) || null,
                }
              : null,
            citizenship: resolveString(entry.citizenship) || null,
            premium: toNumber(entry.premium),
            premiumCurrency: resolveString(entry.premiumCurrency) || null,
            policyPremium: toNumber(entry.policyPremium),
            subrisks: Array.isArray(entry.subrisks)
              ? entry.subrisks
                  .map((subrisk) => resolveString(subrisk))
                  .filter((subrisk): subrisk is string => Boolean(subrisk))
              : null,
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    : [];

  const hasInsurancePayload =
    Boolean(planId) ||
    Boolean(providerRaw) ||
    (price !== null && price > 0) ||
    riskAmount !== null ||
    Boolean(territoryCode) ||
    Boolean(startDate) ||
    Boolean(endDate) ||
    travelers.length > 0;
  if (!hasInsurancePayload) return undefined;

  return clone({
    planId: planId || "efes-travel",
    planName: resolveString(value.planName) || null,
    planLabel: resolveString(value.planLabel) || resolveString(value.label) || null,
    note: resolveString(value.note) || null,
    price,
    currency: resolveString(value.currency) || null,
    provider: providerRaw ? (providerRaw === "efes" ? "efes" : null) : "efes",
    riskAmount,
    riskCurrency: resolveString(value.riskCurrency) || null,
    riskLabel: resolveString(value.riskLabel) || null,
    territoryCode: territoryCode || null,
    territoryLabel: resolveString(value.territoryLabel) || null,
    territoryPolicyLabel: resolveString(value.territoryPolicyLabel) || null,
    travelCountries: resolveString(value.travelCountries) || null,
    startDate: startDate || null,
    endDate: endDate || null,
    days: toNumber(value.days),
    subrisks: Array.isArray(value.subrisks)
      ? value.subrisks
          .map((entry) => resolveString(entry))
          .filter((entry): entry is string => Boolean(entry))
      : null,
    travelers: travelers.length > 0 ? travelers : null,
  } as NonNullable<AoryxBookingPayload["insurance"]>);
};

const parseAirTickets = (
  value: unknown
): NonNullable<AoryxBookingPayload["airTickets"]> | undefined => {
  if (!isRecord(value)) return undefined;
  const price = toNumber(value.price);
  if (price === null || price <= 0) return undefined;
  return {
    origin: resolveString(value.origin) || null,
    destination: resolveString(value.destination) || null,
    departureDate: resolveString(value.departureDate) || null,
    returnDate: resolveString(value.returnDate) || null,
    cabinClass: resolveString(value.cabinClass) || null,
    notes: resolveString(value.notes) || null,
    price,
    currency: resolveString(value.currency) || null,
  };
};

export const parseBookingAddonServices = (value: unknown): BookingAddonServicesPayload => {
  const record = isRecord(value) ? value : {};
  const transferSelection = parseTransferSelection(record.transferSelection);
  const excursions = parseExcursions(record.excursions);
  const insurance = parseInsurance(record.insurance);
  const airTickets = parseAirTickets(record.airTickets);
  return {
    ...(transferSelection ? { transferSelection } : {}),
    ...(excursions ? { excursions } : {}),
    ...(insurance ? { insurance } : {}),
    ...(airTickets ? { airTickets } : {}),
  };
};

export const resolveBookingAddonServiceKeys = (
  payload: BookingAddonServicesPayload
): BookingAddonServiceKey[] => {
  const keys: BookingAddonServiceKey[] = [];
  if (payload.transferSelection) keys.push("transfer");
  if (payload.excursions) keys.push("excursion");
  if (payload.insurance) keys.push("insurance");
  if (payload.airTickets) keys.push("flight");
  return keys;
};

export const resolveExistingBookingAddonServiceKeys = (
  payload: AoryxBookingPayload | null | undefined
): BookingAddonServiceKey[] => {
  if (!payload) return [];
  const keys: BookingAddonServiceKey[] = [];
  if (payload.transferSelection) keys.push("transfer");
  if (payload.excursions) keys.push("excursion");
  if (payload.insurance) keys.push("insurance");
  if (payload.airTickets) keys.push("flight");
  return keys;
};

export const parseBookingAddonCheckoutRequest = (value: unknown): BookingAddonCheckoutRequest | null => {
  if (!isRecord(value)) return null;
  const flow = resolveString(value.flow).toLowerCase();
  if (flow !== "booking_addons") return null;

  const bookingId =
    resolveString(value.bookingId) ||
    resolveString(value.targetBookingId) ||
    resolveString(value.customerRefNumber);
  if (!bookingId) return null;

  const servicesContainer = isRecord(value.addonServices) ? value.addonServices : value;
  const services = parseBookingAddonServices(servicesContainer);
  const serviceKeys = resolveBookingAddonServiceKeys(services);
  if (serviceKeys.length === 0) return null;

  return {
    bookingId,
    services,
    serviceKeys,
  };
};

export const mergeBookingAddonPayload = (
  basePayload: AoryxBookingPayload,
  addons: BookingAddonServicesPayload
): {
  payload: AoryxBookingPayload;
  appliedServiceKeys: BookingAddonServiceKey[];
  skippedServiceKeys: BookingAddonServiceKey[];
} => {
  const appliedServiceKeys: BookingAddonServiceKey[] = [];
  const skippedServiceKeys: BookingAddonServiceKey[] = [];
  const nextPayload: AoryxBookingPayload = {
    ...basePayload,
  };

  if (addons.transferSelection) {
    if (!basePayload.transferSelection) {
      nextPayload.transferSelection = clone(addons.transferSelection);
      appliedServiceKeys.push("transfer");
    } else {
      skippedServiceKeys.push("transfer");
    }
  }

  if (addons.excursions) {
    if (!basePayload.excursions) {
      nextPayload.excursions = clone(addons.excursions);
      appliedServiceKeys.push("excursion");
    } else {
      skippedServiceKeys.push("excursion");
    }
  }

  if (addons.insurance) {
    if (!basePayload.insurance) {
      nextPayload.insurance = clone(addons.insurance);
      appliedServiceKeys.push("insurance");
    } else {
      skippedServiceKeys.push("insurance");
    }
  }

  if (addons.airTickets) {
    if (!basePayload.airTickets) {
      nextPayload.airTickets = clone(addons.airTickets);
      appliedServiceKeys.push("flight");
    } else {
      skippedServiceKeys.push("flight");
    }
  }

  return {
    payload: nextPayload,
    appliedServiceKeys,
    skippedServiceKeys,
  };
};

const resolveAmdRate = async (
  currency: string,
  rates: AmdRates,
  cache: Map<string, number>
): Promise<number | null> => {
  const normalized = normalizeCurrencyCode(currency);
  if (normalized === "AMD") return 1;
  if (normalized === "USD") return rates.USD;
  if (normalized === "EUR") return rates.EUR;
  const cached = cache.get(normalized);
  if (cached != null) return cached;
  const resolved = await getAmdRateForCurrency(normalized);
  if (resolved === null) return null;
  cache.set(normalized, resolved);
  return resolved;
};

const convertAmountToAmd = async (
  amount: number,
  currency: string,
  rates: AmdRates,
  cache: Map<string, number>
) => {
  const direct = convertToAmd(amount, currency, rates);
  if (direct !== null) return direct;
  const rate = await resolveAmdRate(currency, rates, cache);
  if (rate === null) return null;
  return amount * rate;
};

export const calculateBookingAddonAmountAmd = async (
  addons: BookingAddonServicesPayload,
  fallbackCurrency: string | null | undefined
): Promise<BookingAddonAmdTotals> => {
  const rates = await getAmdRates();
  const rateCache = new Map<string, number>();
  const fallback = resolveString(fallbackCurrency) || "USD";

  let transfer = 0;
  if (addons.transferSelection) {
    const amount = toNumber(addons.transferSelection.totalPrice);
    if (amount === null || amount <= 0) {
      throw new Error("Transfer amount is invalid.");
    }
    const currency =
      resolveString(addons.transferSelection.pricing?.currency) ||
      resolveString((addons.transferSelection as { currency?: unknown }).currency) ||
      fallback;
    const converted = await convertAmountToAmd(amount, currency, rates, rateCache);
    if (converted === null) {
      throw new Error(`Missing exchange rate for ${currency}.`);
    }
    transfer = converted;
  }

  let excursions = 0;
  if (addons.excursions) {
    const amount = toNumber(addons.excursions.totalAmount);
    if (amount === null || amount <= 0) {
      throw new Error("Excursion amount is invalid.");
    }
    const currency =
      resolveString(addons.excursions.selections?.[0]?.currency) ||
      resolveString((addons.excursions as { currency?: unknown }).currency) ||
      fallback;
    const converted = await convertAmountToAmd(amount, currency, rates, rateCache);
    if (converted === null) {
      throw new Error(`Missing exchange rate for ${currency}.`);
    }
    excursions = converted;
  }

  let insurance = 0;
  if (addons.insurance) {
    const amount = toNumber(addons.insurance.price);
    if (amount === null || amount <= 0) {
      throw new Error("Insurance amount is invalid.");
    }
    const currency = resolveString(addons.insurance.currency) || fallback;
    const converted = await convertAmountToAmd(amount, currency, rates, rateCache);
    if (converted === null) {
      throw new Error(`Missing exchange rate for ${currency}.`);
    }
    insurance = converted;
  }

  let flights = 0;
  if (addons.airTickets) {
    const amount = toNumber(addons.airTickets.price);
    if (amount === null || amount <= 0) {
      throw new Error("Flight amount is invalid.");
    }
    const currency = resolveString(addons.airTickets.currency) || fallback;
    const converted = await convertAmountToAmd(amount, currency, rates, rateCache);
    if (converted === null) {
      throw new Error(`Missing exchange rate for ${currency}.`);
    }
    flights = converted;
  }

  return {
    totalAmd: transfer + excursions + insurance + flights,
    breakdownAmd: {
      transfer,
      excursions,
      insurance,
      flights,
    },
  };
};

export const isBookingConfirmed = (booking: AoryxBookingResult | null | undefined) => {
  if (!booking) return false;
  const status = resolveString(booking.status);
  if (status === "2") return true;
  return Boolean(
    resolveString(booking.hotelConfirmationNumber) ||
      resolveString(booking.supplierConfirmationNumber) ||
      resolveString(booking.adsConfirmationNumber)
  );
};

export const isBookingCanceled = (booking: AoryxBookingResult | null | undefined) => {
  const status = resolveString(booking?.status).toLowerCase();
  if (!status) return false;
  return status === "4" || status.includes("cancel");
};
