import { getDb } from "@/lib/db";
import { listAoryxDestinations } from "@/lib/aoryx-destinations";
import { runAoryxSearch } from "@/lib/aoryx-search";
import { fetchExcursions, fetchTransferRates } from "@/lib/aoryx-addons";
import { searchFlydubai } from "@/lib/flydubai-client";
import { quoteEfesTravelCost } from "@/lib/efes-client";
import { resolveSafeErrorMessage } from "@/lib/error-utils";
import { DEFAULT_SERVICE_FLAGS } from "@/lib/package-builder-state";
import { getServiceFlags } from "@/lib/service-flags";
import type { Locale } from "@/lib/i18n";
import type {
  AoryxRoomSearch,
  AoryxTransferChargeType,
  AoryxTransferLocation,
  AoryxTransferPricing,
  AoryxTransferVehicle,
} from "@/types/aoryx";
import type { FlydubaiSearchRequest } from "@/types/flydubai";
import type {
  PackageAssistantApiMessage,
  PackageAssistantContext,
  PackageAssistantDraft,
  PackageAssistantFlightDraft,
  PackageAssistantHotelDraft,
  PackageAssistantInsuranceDraft,
  PackageAssistantPackageOption,
  PackageAssistantPriceAudit,
  PackageAssistantPriceAuditIssue,
  PackageAssistantProgressEvent,
  PackageAssistantReply,
  PackageAssistantReplyStage,
  PackageAssistantTransferDraft,
} from "@/types/package-assistant";

const OPENAI_API_KEY =
  typeof process.env.OPENAI_API_KEY === "string" ? process.env.OPENAI_API_KEY.trim() : "";
const OPENAI_BASE_URL =
  typeof process.env.OPENAI_API_URL === "string" && process.env.OPENAI_API_URL.trim().length > 0
    ? process.env.OPENAI_API_URL.trim()
    : "https://api.openai.com/v1/chat/completions";
const OPENAI_PACKAGE_MODEL_PRIMARY =
  typeof process.env.OPENAI_PACKAGE_ASSISTANT_MODEL === "string" &&
  process.env.OPENAI_PACKAGE_ASSISTANT_MODEL.trim().length > 0
    ? process.env.OPENAI_PACKAGE_ASSISTANT_MODEL.trim()
    : "gpt-5-mini";
const OPENAI_PACKAGE_MODEL_FALLBACK =
  typeof process.env.OPENAI_PACKAGE_ASSISTANT_MODEL_FALLBACK === "string" &&
  process.env.OPENAI_PACKAGE_ASSISTANT_MODEL_FALLBACK.trim().length > 0
    ? process.env.OPENAI_PACKAGE_ASSISTANT_MODEL_FALLBACK.trim()
    : "gpt-4o-mini";
const OPENAI_TIMEOUT_MS = 30000;
const MAX_CONVERSATION_MESSAGES = 14;
const MAX_TOOL_ROUNDS = 5;
const MAX_PACKAGE_OPTIONS = 3;
const MAX_USER_SIGNAL_ITEMS = 5;
const DEFAULT_INSURANCE_TERRITORY_CODE = "whole_world_exc_uk_sch_us_ca_au_jp";
const DEFAULT_INSURANCE_RISK_AMOUNT = 15000;
const DEFAULT_INSURANCE_RISK_CURRENCY = "EUR";
const DEFAULT_INSURANCE_RISK_LABEL = "STANDARD";
const DEFAULT_INSURANCE_ADULT_AGE = 30;
const DEFAULT_INSURANCE_CHILD_AGE = 8;
const OPENAI_PACKAGE_ASSISTANT_FULL_CONTEXT_ENABLED =
  typeof process.env.OPENAI_PACKAGE_ASSISTANT_FULL_CONTEXT === "string"
    ? ["1", "true", "yes", "on"].includes(
        process.env.OPENAI_PACKAGE_ASSISTANT_FULL_CONTEXT.trim().toLowerCase()
      )
    : true;

type OpenAiToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type OpenAiMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: OpenAiToolCall[];
};

type OpenAiCompletionPayload = {
  choices?: Array<{
    message?: OpenAiMessage | null;
  }>;
};

type ToolExecutionContext = {
  locale: Locale;
  context: PackageAssistantContext | null;
};

type ToolExecutionResult = {
  ok: boolean;
  tool: string;
  data?: unknown;
  error?: string;
};

type AssistantGenerationInput = {
  locale: Locale;
  messages: PackageAssistantApiMessage[];
  context?: PackageAssistantContext | null;
  userId?: string | null;
  onProgress?: (event: PackageAssistantProgressEvent) => void | Promise<void>;
};

export type AssistantGenerationOutput = {
  reply: PackageAssistantReply;
  meta: {
    model: string;
    toolCalls: number;
    priceAudit: PackageAssistantPriceAudit;
  };
};

type AssistantPersistenceInput = {
  sessionId: string;
  locale: Locale;
  userId?: string | null;
  userMessage: string | null;
  context: PackageAssistantContext | null;
  reply: PackageAssistantReply;
  model: string;
  toolCalls: number;
  priceAudit: PackageAssistantPriceAudit;
};

type HotelPriceEvidence = {
  hotelCode: string | null;
  hotelName: string | null;
  price: number | null;
  currency: string | null;
};

type TransferPriceEvidence = {
  id: string | null;
  transferType: string | null;
  vehicleName: string | null;
  oneWay: number | null;
  returnPrice: number | null;
  currency: string | null;
};

type FlightPriceEvidence = {
  id: string;
  totalPrice: number | null;
  currency: string | null;
  origin: string | null;
  destination: string | null;
  departureDate: string | null;
  returnDate: string | null;
};

type ExcursionPriceEvidence = {
  id: string | null;
  name: string | null;
  adultPrice: number | null;
  childPrice: number | null;
  currency: string | null;
};

type InsurancePriceEvidence = {
  totalPremium: number | null;
  currency: string | null;
  startDate: string | null;
  endDate: string | null;
  days: number | null;
  territoryCode: string | null;
  riskAmount: number | null;
  riskCurrency: string | null;
  travelerCount: number | null;
};

type ToolPriceEvidence = {
  hotels: HotelPriceEvidence[];
  transfers: TransferPriceEvidence[];
  flights: FlightPriceEvidence[];
  excursions: ExcursionPriceEvidence[];
  insurances: InsurancePriceEvidence[];
};

type AssistantProjectContext = {
  serviceFlags: Record<string, boolean>;
  userSignals: {
    profile: {
      name: string | null;
      email: string | null;
    } | null;
    recentSearches: Array<{
      destinationName: string | null;
      destinationCode: string | null;
      checkInDate: string | null;
      checkOutDate: string | null;
      travelers: number | null;
      createdAt: string | null;
    }>;
    favoriteHotels: Array<{
      hotelCode: string | null;
      name: string | null;
      city: string | null;
      rating: number | null;
    }>;
    recentBookings: Array<{
      destinationName: string | null;
      hotelName: string | null;
      checkInDate: string | null;
      checkOutDate: string | null;
      createdAt: string | null;
    }>;
    recentAssistantSessions: Array<{
      stage: string | null;
      missing: string[];
      packageOptions: number | null;
      updatedAt: string | null;
    }>;
  } | null;
};

type InsuranceQuoteTravelerInput = {
  id: string;
  age: number;
  passportNumber: string | null;
  socialCard: string | null;
  subrisks: string[] | undefined;
};

const localeLanguageName: Record<Locale, string> = {
  hy: "Armenian",
  en: "English",
  ru: "Russian",
};

const parseRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const toTrimmedString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const clampInteger = (value: unknown, min: number, max: number, fallback: number): number => {
  const numeric = toFiniteNumber(value);
  if (numeric === null) return fallback;
  return Math.min(max, Math.max(min, Math.floor(numeric)));
};

const toBoolean = (value: unknown): boolean | null => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return null;
};

const toCurrencyCode = (value: unknown): string | null => {
  const asString = toTrimmedString(value)?.toUpperCase() ?? null;
  if (!asString) return null;
  return /^[A-Z]{3}$/.test(asString) ? asString : null;
};

const toIsoDate = (value: unknown): string | null => {
  const raw = toTrimmedString(value);
  if (!raw) return null;
  const candidate = raw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return null;
  const date = new Date(`${candidate}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : candidate;
};

const toArrayOfStrings = (value: unknown, max = 8): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => toTrimmedString(entry))
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, max);
};

const uniqueStrings = (values: string[], max = 8) => {
  const seen = new Set<string>();
  const output: string[] = [];
  values.forEach((value) => {
    const key = value.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    output.push(value);
  });
  return output.slice(0, max);
};

const buildRooms = (adults: number, children: number, roomCount: number): AoryxRoomSearch[] => {
  const safeRoomCount = Math.max(1, roomCount);
  const safeAdults = Math.max(safeRoomCount, adults);
  const safeChildren = Math.max(0, children);
  const adultBase = Math.floor(safeAdults / safeRoomCount);
  const adultRemainder = safeAdults % safeRoomCount;
  const childBase = Math.floor(safeChildren / safeRoomCount);
  const childRemainder = safeChildren % safeRoomCount;

  return Array.from({ length: safeRoomCount }, (_, index) => {
    const adultCount = adultBase + (index < adultRemainder ? 1 : 0);
    const childCount = childBase + (index < childRemainder ? 1 : 0);
    return {
      roomIdentifier: index + 1,
      adults: Math.max(1, adultCount),
      childrenAges: Array.from({ length: childCount }, () => 8),
    };
  });
};

const createToolPriceEvidence = (): ToolPriceEvidence => ({
  hotels: [],
  transfers: [],
  flights: [],
  excursions: [],
  insurances: [],
});

const toIsoDateTime = (value: unknown): string | null => {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const asString = toTrimmedString(value);
  if (!asString) return null;
  const parsed = new Date(asString);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const toSafeInteger = (value: unknown): number | null => {
  const parsed = toFiniteNumber(value);
  if (parsed === null) return null;
  return Math.floor(parsed);
};

const countGuestsFromSearchRooms = (value: unknown): number | null => {
  if (!Array.isArray(value)) return null;
  let total = 0;
  value.forEach((entry) => {
    const record = parseRecord(entry);
    if (!record) return;
    const adults = Math.max(0, toSafeInteger(record.adults) ?? 0);
    const childrenAges = Array.isArray(record.childrenAges) ? record.childrenAges.length : 0;
    total += adults + childrenAges;
  });
  return total > 0 ? total : null;
};

const buildInsuranceTravelersFromContext = (
  context: PackageAssistantContext | null
): InsuranceQuoteTravelerInput[] => {
  const adults = clampInteger(context?.adults, 1, 12, 1);
  const children = clampInteger(context?.children, 0, 8, 0);
  const travelers: InsuranceQuoteTravelerInput[] = [];
  for (let index = 0; index < adults; index += 1) {
    travelers.push({
      id: `adult-${index + 1}`,
      age: DEFAULT_INSURANCE_ADULT_AGE,
      passportNumber: null,
      socialCard: null,
      subrisks: undefined,
    });
  }
  for (let index = 0; index < children; index += 1) {
    travelers.push({
      id: `child-${index + 1}`,
      age: DEFAULT_INSURANCE_CHILD_AGE,
      passportNumber: null,
      socialCard: null,
      subrisks: undefined,
    });
  }
  return travelers;
};

const normalizeInsuranceTravelersArg = (value: unknown): InsuranceQuoteTravelerInput[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry, index) => {
      const record = parseRecord(entry);
      if (!record) return null;
      const age = clampInteger(record.age, 0, 99, -1);
      if (age < 0) return null;
      const id = toTrimmedString(record.id) ?? `traveler-${index + 1}`;
      const subrisks = uniqueStrings(toArrayOfStrings(record.subrisks, 12), 12);
      return {
        id,
        age,
        passportNumber: toTrimmedString(record.passportNumber),
        socialCard: toTrimmedString(record.socialCard),
        subrisks: subrisks.length > 0 ? subrisks : undefined,
      };
    })
    .filter(
      (entry): entry is InsuranceQuoteTravelerInput => Boolean(entry)
    )
    .slice(0, 12);
};

const normalizeMatchToken = (value: string | null | undefined) =>
  typeof value === "string"
    ? value
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .replace(/\s+/g, " ")
        .trim()
    : "";

const amountsClose = (left: number, right: number) =>
  Math.abs(left - right) <= Math.max(3, Math.abs(right) * 0.03);

const currenciesMatch = (left: string | null | undefined, right: string | null | undefined) => {
  const normalizedLeft = toCurrencyCode(left);
  const normalizedRight = toCurrencyCode(right);
  if (!normalizedLeft || !normalizedRight) return false;
  return normalizedLeft === normalizedRight;
};

const findHotelEvidence = (
  draft: PackageAssistantHotelDraft,
  evidence: ToolPriceEvidence
): HotelPriceEvidence | null => {
  const hotelCode = toTrimmedString(draft.hotelCode);
  if (hotelCode) {
    const byCode = evidence.hotels.find(
      (entry) => toTrimmedString(entry.hotelCode)?.toLowerCase() === hotelCode.toLowerCase()
    );
    if (byCode) return byCode;
  }

  const hotelName = normalizeMatchToken(draft.hotelName);
  if (!hotelName) return null;
  return (
    evidence.hotels.find((entry) => {
      const entryName = normalizeMatchToken(entry.hotelName);
      if (!entryName) return false;
      return entryName.includes(hotelName) || hotelName.includes(entryName);
    }) ?? null
  );
};

const findTransferEvidence = (
  draft: PackageAssistantTransferDraft,
  evidence: ToolPriceEvidence
): TransferPriceEvidence | null => {
  const selectionId = toTrimmedString(draft.selectionId);
  if (selectionId) {
    const byId = evidence.transfers.find(
      (entry) => toTrimmedString(entry.id)?.toLowerCase() === selectionId.toLowerCase()
    );
    if (byId) return byId;
  }

  const vehicleName = normalizeMatchToken(draft.vehicleName);
  if (!vehicleName) return null;
  return (
    evidence.transfers.find((entry) => {
      const entryVehicle = normalizeMatchToken(entry.vehicleName);
      return entryVehicle.length > 0 && (entryVehicle.includes(vehicleName) || vehicleName.includes(entryVehicle));
    }) ?? null
  );
};

const findFlightEvidence = (
  draft: PackageAssistantFlightDraft,
  evidence: ToolPriceEvidence
): FlightPriceEvidence | null => {
  const selectionId = toTrimmedString(draft.selectionId);
  if (selectionId) {
    const byId = evidence.flights.find((entry) => entry.id.toLowerCase() === selectionId.toLowerCase());
    if (byId) return byId;
  }

  const origin = toTrimmedString(draft.origin)?.toUpperCase();
  const destination = toTrimmedString(draft.destination)?.toUpperCase();
  const departureDate = toIsoDate(draft.departureDate);
  if (!origin || !destination || !departureDate) return null;

  return (
    evidence.flights.find(
      (entry) =>
        entry.origin?.toUpperCase() === origin &&
        entry.destination?.toUpperCase() === destination &&
        entry.departureDate === departureDate
    ) ?? null
  );
};

const findExcursionEvidenceById = (
  itemId: string | null | undefined,
  evidence: ToolPriceEvidence
) => {
  const normalized = toTrimmedString(itemId);
  if (!normalized) return null;
  return (
    evidence.excursions.find(
      (entry) => toTrimmedString(entry.id)?.toLowerCase() === normalized.toLowerCase()
    ) ?? null
  );
};

const findInsuranceEvidence = (
  draft: PackageAssistantInsuranceDraft,
  evidence: ToolPriceEvidence
): InsurancePriceEvidence | null => {
  const startDate = toIsoDate(draft.startDate);
  const endDate = toIsoDate(draft.endDate);
  const days = toSafeInteger(draft.days);
  const riskAmount = toFiniteNumber(draft.riskAmount);
  const riskCurrency = toCurrencyCode(draft.riskCurrency);

  const strict = evidence.insurances.find((entry) => {
    const sameDates =
      (!startDate || entry.startDate === startDate) &&
      (!endDate || entry.endDate === endDate);
    const sameDays = days === null || entry.days === days;
    const sameRisk =
      riskAmount === null ||
      entry.riskAmount === null ||
      (entry.riskAmount !== null && amountsClose(entry.riskAmount, riskAmount));
    const sameRiskCurrency =
      !riskCurrency || !entry.riskCurrency || currenciesMatch(riskCurrency, entry.riskCurrency);
    return sameDates && sameDays && sameRisk && sameRiskCurrency;
  });
  if (strict) return strict;

  return evidence.insurances[0] ?? null;
};

const buildIssue = (
  optionId: string,
  service: PackageAssistantPriceAuditIssue["service"],
  reason: string,
  amount?: number | null,
  currency?: string | null
): PackageAssistantPriceAuditIssue => ({
  optionId,
  service,
  reason,
  providedAmount: typeof amount === "number" && Number.isFinite(amount) ? amount : null,
  providedCurrency: toCurrencyCode(currency),
});

const applyHardPriceAudit = (
  reply: PackageAssistantReply,
  evidence: ToolPriceEvidence
): { reply: PackageAssistantReply; audit: PackageAssistantPriceAudit } => {
  const issues: PackageAssistantPriceAuditIssue[] = [];

  const packageOptions = reply.packageOptions.map((option) => {
    const nextOption: PackageAssistantPackageOption = {
      ...option,
      draft: { ...option.draft },
    };
    const verifiedBreakdown: Array<{ amount: number; currency: string }> = [];

    if (nextOption.draft.hotel?.selected) {
      const hotel = { ...nextOption.draft.hotel };
      const providedAmount = toFiniteNumber(hotel.price);
      const providedCurrency = toCurrencyCode(hotel.currency);
      if (providedAmount !== null && providedCurrency) {
        const candidate = findHotelEvidence(hotel, evidence);
        if (
          !candidate ||
          candidate.price === null ||
          !candidate.currency ||
          !currenciesMatch(providedCurrency, candidate.currency) ||
          !amountsClose(providedAmount, candidate.price)
        ) {
          issues.push(
            buildIssue(
              option.id,
              "hotel",
              "unverified_hotel_price_removed",
              providedAmount,
              providedCurrency
            )
          );
          hotel.price = null;
          hotel.currency = null;
        } else {
          verifiedBreakdown.push({ amount: providedAmount, currency: providedCurrency });
        }
      }
      nextOption.draft.hotel = hotel;
    }

    if (nextOption.draft.transfer?.selected) {
      const transfer = { ...nextOption.draft.transfer };
      const providedAmount = toFiniteNumber(transfer.price);
      const providedCurrency = toCurrencyCode(transfer.currency);
      if (providedAmount !== null && providedCurrency) {
        const candidate = findTransferEvidence(transfer, evidence);
        const expectedCandidates =
          candidate && candidate.currency && currenciesMatch(providedCurrency, candidate.currency)
            ? [candidate.oneWay, candidate.returnPrice]
                .map((entry) => toFiniteNumber(entry))
                .filter((entry): entry is number => entry !== null)
            : [];
        const matched = expectedCandidates.some((entry) => amountsClose(providedAmount, entry));

        if (!matched) {
          issues.push(
            buildIssue(
              option.id,
              "transfer",
              "unverified_transfer_price_removed",
              providedAmount,
              providedCurrency
            )
          );
          transfer.price = null;
          transfer.currency = null;
        } else {
          verifiedBreakdown.push({ amount: providedAmount, currency: providedCurrency });
        }
      }
      nextOption.draft.transfer = transfer;
    }

    if (nextOption.draft.flight?.selected) {
      const flight = { ...nextOption.draft.flight };
      const providedAmount = toFiniteNumber(flight.price);
      const providedCurrency = toCurrencyCode(flight.currency);
      if (providedAmount !== null && providedCurrency) {
        const candidate = findFlightEvidence(flight, evidence);
        const matched =
          candidate &&
          candidate.totalPrice !== null &&
          candidate.currency &&
          currenciesMatch(providedCurrency, candidate.currency) &&
          amountsClose(providedAmount, candidate.totalPrice);
        if (!matched) {
          issues.push(
            buildIssue(
              option.id,
              "flight",
              "unverified_flight_price_removed",
              providedAmount,
              providedCurrency
            )
          );
          flight.price = null;
          flight.currency = null;
        } else {
          verifiedBreakdown.push({ amount: providedAmount, currency: providedCurrency });
        }
      }
      nextOption.draft.flight = flight;
    }

    if (nextOption.draft.excursion?.selected) {
      const excursion = {
        ...nextOption.draft.excursion,
        items: Array.isArray(nextOption.draft.excursion.items)
          ? nextOption.draft.excursion.items.map((item) => ({ ...item }))
          : [],
      };

      excursion.items?.forEach((item) => {
        const providedAmount = toFiniteNumber(item.price);
        const providedCurrency = toCurrencyCode(item.currency);
        if (providedAmount === null || !providedCurrency) return;

        const candidate = findExcursionEvidenceById(item.id, evidence);
        const matched =
          candidate &&
          candidate.currency &&
          currenciesMatch(providedCurrency, candidate.currency) &&
          ((candidate.adultPrice !== null && amountsClose(providedAmount, candidate.adultPrice)) ||
            (candidate.childPrice !== null && amountsClose(providedAmount, candidate.childPrice)));

        if (!matched) {
          issues.push(
            buildIssue(
              option.id,
              "excursion",
              "unverified_excursion_item_price_removed",
              providedAmount,
              providedCurrency
            )
          );
          item.price = null;
          item.currency = null;
          return;
        }
        verifiedBreakdown.push({ amount: providedAmount, currency: providedCurrency });
      });

      const excursionAmount = toFiniteNumber(excursion.price);
      const excursionCurrency = toCurrencyCode(excursion.currency);
      if (excursionAmount !== null && excursionCurrency) {
        const knownTotal = (excursion.items ?? [])
          .map((item) =>
            toCurrencyCode(item.currency) === excursionCurrency ? toFiniteNumber(item.price) : null
          )
          .filter((value): value is number => value !== null)
          .reduce((sum, value) => sum + value, 0);
        const hasBreakdown = knownTotal > 0;
        if (hasBreakdown && !amountsClose(excursionAmount, knownTotal)) {
          issues.push(
            buildIssue(
              option.id,
              "excursion",
              "unverified_excursion_total_price_removed",
              excursionAmount,
              excursionCurrency
            )
          );
          excursion.price = null;
          excursion.currency = null;
        } else if (!hasBreakdown) {
          issues.push(
            buildIssue(
              option.id,
              "excursion",
              "excursion_total_without_item_evidence_removed",
              excursionAmount,
              excursionCurrency
            )
          );
          excursion.price = null;
          excursion.currency = null;
        }
      }

      nextOption.draft.excursion = excursion;
    }

    if (nextOption.draft.insurance?.selected) {
      const insurance = { ...nextOption.draft.insurance };
      const providedAmount = toFiniteNumber(insurance.price);
      const providedCurrency = toCurrencyCode(insurance.currency);
      if (providedAmount !== null || providedCurrency) {
        const candidate = findInsuranceEvidence(insurance, evidence);
        const matched =
          providedAmount !== null &&
          Boolean(providedCurrency) &&
          candidate &&
          candidate.totalPremium !== null &&
          candidate.currency &&
          currenciesMatch(providedCurrency, candidate.currency) &&
          amountsClose(providedAmount, candidate.totalPremium);

        if (!matched) {
          issues.push(
            buildIssue(
              option.id,
              "insurance",
              "unverified_insurance_price_removed",
              providedAmount,
              providedCurrency
            )
          );
          insurance.price = null;
          insurance.currency = null;
        } else {
          verifiedBreakdown.push({ amount: providedAmount, currency: providedCurrency as string });
        }
      }
      nextOption.draft.insurance = insurance;
    }

    if (
      nextOption.approxTotal &&
      typeof nextOption.approxTotal.amount === "number" &&
      Number.isFinite(nextOption.approxTotal.amount)
    ) {
      const totalCurrency = toCurrencyCode(nextOption.approxTotal.currency);
      if (totalCurrency) {
        const verifiedTotal = verifiedBreakdown
          .filter((entry) => entry.currency === totalCurrency)
          .reduce((sum, entry) => sum + entry.amount, 0);
        if (verifiedTotal > 0 && !amountsClose(nextOption.approxTotal.amount, verifiedTotal)) {
          issues.push(
            buildIssue(
              option.id,
              "total",
              "approx_total_removed_mismatch_with_verified_prices",
              nextOption.approxTotal.amount,
              totalCurrency
            )
          );
          nextOption.approxTotal = {
            ...nextOption.approxTotal,
            amount: null,
          };
        }
      }
    }

    return nextOption;
  });

  return {
    reply: {
      ...reply,
      packageOptions,
    },
    audit: {
      status: issues.length > 0 ? "fail" : "pass",
      issues,
      checkedAt: new Date().toISOString(),
    },
  };
};

const buildFallbackReply = (locale: Locale): PackageAssistantReply => {
  if (locale === "ru") {
    return {
      message:
        "Я готов собрать ваш тур. Напишите направление, даты, количество взрослых/детей и примерный бюджет.",
      stage: "collecting",
      missing: ["destination", "dates", "travelers"],
      followUps: [],
      packageOptions: [],
    };
  }
  if (locale === "hy") {
    return {
      message:
        "Պատրաստ եմ հավաքել ձեր փաթեթը։ Գրեք ուղղությունը, ամսաթվերը, մեծահասակ/երեխա քանակը և մոտավոր բյուջեն։",
      stage: "collecting",
      missing: ["destination", "dates", "travelers"],
      followUps: [],
      packageOptions: [],
    };
  }
  return {
    message:
      "I can build your package now. Share destination, dates, traveler count, and your rough budget.",
    stage: "collecting",
    missing: ["destination", "dates", "travelers"],
    followUps: [],
    packageOptions: [],
  };
};

const loadAssistantProjectContext = async (
  userIdInput?: string | null
): Promise<AssistantProjectContext> => {
  let serviceFlags: Record<string, boolean> = { ...DEFAULT_SERVICE_FLAGS };
  try {
    serviceFlags = await getServiceFlags();
  } catch {
    serviceFlags = { ...DEFAULT_SERVICE_FLAGS };
  }

  const userId = toTrimmedString(userIdInput);
  if (!OPENAI_PACKAGE_ASSISTANT_FULL_CONTEXT_ENABLED || !userId) {
    return {
      serviceFlags,
      userSignals: null,
    };
  }

  try {
    const db = await getDb();
    const profileCollection = db.collection<Record<string, unknown>>("user_profiles");
    let profileDoc = await profileCollection.findOne(
      { userIdString: userId },
      {
        projection: {
          userIdString: 1,
          name: 1,
          email: 1,
          emailLower: 1,
        },
      }
    );

    if (!profileDoc && userId.includes("@")) {
      profileDoc = await profileCollection.findOne(
        { emailLower: userId.toLowerCase() },
        {
          projection: {
            userIdString: 1,
            name: 1,
            email: 1,
            emailLower: 1,
          },
        }
      );
    }

    const resolvedUserId = toTrimmedString(parseRecord(profileDoc)?.userIdString) ?? userId;

    const [searchDocs, favoriteDocs, bookingDocs, sessionDocs] = await Promise.all([
      db
        .collection<Record<string, unknown>>("user_searches")
        .find({ userIdString: resolvedUserId })
        .sort({ createdAt: -1 })
        .limit(MAX_USER_SIGNAL_ITEMS)
        .project({
          createdAt: 1,
          params: 1,
          resultSummary: 1,
        })
        .toArray(),
      db
        .collection<Record<string, unknown>>("user_favorites")
        .find({ userIdString: resolvedUserId })
        .sort({ savedAt: -1 })
        .limit(MAX_USER_SIGNAL_ITEMS)
        .project({
          hotelCode: 1,
          name: 1,
          city: 1,
          rating: 1,
        })
        .toArray(),
      db
        .collection<Record<string, unknown>>("user_bookings")
        .find({ userIdString: resolvedUserId })
        .sort({ createdAt: -1 })
        .limit(3)
        .project({
          createdAt: 1,
          payload: 1,
        })
        .toArray(),
      db
        .collection<Record<string, unknown>>("package_assistant_sessions")
        .find({ userId: resolvedUserId })
        .sort({ updatedAt: -1 })
        .limit(4)
        .project({
          updatedAt: 1,
          lastStage: 1,
          lastMissing: 1,
          lastPackageOptions: 1,
        })
        .toArray(),
    ]);

    const recentSearches = searchDocs.map((entry) => {
      const record = parseRecord(entry) ?? {};
      const resultSummary = parseRecord(record.resultSummary);
      const params = parseRecord(record.params);
      return {
        destinationName:
          toTrimmedString(resultSummary?.destinationName) ??
          toTrimmedString(params?.destinationCode) ??
          toTrimmedString(params?.hotelCode),
        destinationCode:
          toTrimmedString(resultSummary?.destinationCode) ??
          toTrimmedString(params?.destinationCode) ??
          null,
        checkInDate: toIsoDate(params?.checkInDate),
        checkOutDate: toIsoDate(params?.checkOutDate),
        travelers: countGuestsFromSearchRooms(params?.rooms),
        createdAt: toIsoDateTime(record.createdAt),
      };
    });

    const favoriteHotels = favoriteDocs.map((entry) => {
      const record = parseRecord(entry) ?? {};
      return {
        hotelCode: toTrimmedString(record.hotelCode),
        name: toTrimmedString(record.name),
        city: toTrimmedString(record.city),
        rating: toFiniteNumber(record.rating),
      };
    });

    const recentBookings = bookingDocs.map((entry) => {
      const record = parseRecord(entry) ?? {};
      const payload = parseRecord(record.payload);
      const hotel = parseRecord(payload?.hotel);
      return {
        destinationName:
          toTrimmedString(payload?.destinationName) ?? toTrimmedString(payload?.destinationCode),
        hotelName:
          toTrimmedString(payload?.hotelName) ??
          toTrimmedString(payload?.hotelCode) ??
          toTrimmedString(hotel?.name),
        checkInDate: toIsoDate(payload?.checkInDate),
        checkOutDate: toIsoDate(payload?.checkOutDate),
        createdAt: toIsoDateTime(record.createdAt),
      };
    });

    const recentAssistantSessions = sessionDocs.map((entry) => {
      const record = parseRecord(entry) ?? {};
      return {
        stage: toTrimmedString(record.lastStage),
        missing: uniqueStrings(toArrayOfStrings(record.lastMissing, 8), 8),
        packageOptions: toSafeInteger(record.lastPackageOptions),
        updatedAt: toIsoDateTime(record.updatedAt),
      };
    });

    const profileRecord = parseRecord(profileDoc);
    const profile =
      profileRecord && (toTrimmedString(profileRecord.name) || toTrimmedString(profileRecord.email))
        ? {
            name: toTrimmedString(profileRecord.name),
            email: toTrimmedString(profileRecord.email),
          }
        : null;

    const hasSignals =
      Boolean(profile) ||
      recentSearches.length > 0 ||
      favoriteHotels.length > 0 ||
      recentBookings.length > 0 ||
      recentAssistantSessions.length > 0;

    return {
      serviceFlags,
      userSignals: hasSignals
        ? {
            profile,
            recentSearches,
            favoriteHotels,
            recentBookings,
            recentAssistantSessions,
          }
        : null,
    };
  } catch (error) {
    console.error("[PackageAssistant] Failed to load integrated context", error);
    return {
      serviceFlags,
      userSignals: null,
    };
  }
};

const applyServiceAvailabilityToReply = (
  reply: PackageAssistantReply,
  serviceFlags: Record<string, boolean>,
  locale: Locale
): PackageAssistantReply => {
  const serviceKeys: Array<keyof PackageAssistantDraft> = [
    "hotel",
    "transfer",
    "flight",
    "excursion",
    "insurance",
  ];
  let removedAny = false;

  const packageOptions = reply.packageOptions
    .map((option) => {
      const nextDraft: PackageAssistantDraft = { ...option.draft };
      serviceKeys.forEach((serviceKey) => {
        if (serviceFlags[serviceKey] === false && nextDraft[serviceKey]) {
          delete nextDraft[serviceKey];
          removedAny = true;
        }
      });

      const hasAnyService = serviceKeys.some((serviceKey) => Boolean(nextDraft[serviceKey]));
      if (!hasAnyService) {
        removedAny = true;
        return null;
      }
      return {
        ...option,
        draft: nextDraft,
      };
    })
    .filter((entry): entry is PackageAssistantPackageOption => Boolean(entry));

  if (!removedAny) return reply;

  const followUpNotice =
    locale === "ru"
      ? "Некоторые услуги сейчас отключены и были скрыты из вариантов."
      : locale === "hy"
        ? "Որոշ ծառայություններ այժմ անջատված են և հեռացվել են տարբերակներից։"
        : "Some services are currently disabled and were removed from the options.";

  return {
    ...reply,
    stage: packageOptions.length > 0 ? reply.stage : "collecting",
    packageOptions,
    followUps: uniqueStrings([...reply.followUps, followUpNotice], 5),
  };
};

const toolDefinitions = [
  {
    type: "function",
    function: {
      name: "lookup_destinations",
      description: "Find destination codes by name/country before a hotel search.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          countryCode: { type: "string", description: "ISO-2 country code, for example AE." },
          limit: { type: "integer", minimum: 1, maximum: 30 },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_hotels",
      description:
        "Search real hotel inventory with dates/occupancy. Use this before proposing concrete hotel options.",
      parameters: {
        type: "object",
        properties: {
          destinationCode: { type: "string" },
          hotelCode: { type: "string" },
          checkInDate: { type: "string", description: "YYYY-MM-DD" },
          checkOutDate: { type: "string", description: "YYYY-MM-DD" },
          roomCount: { type: "integer", minimum: 1, maximum: 4 },
          adults: { type: "integer", minimum: 1, maximum: 12 },
          children: { type: "integer", minimum: 0, maximum: 8 },
          countryCode: { type: "string" },
          nationality: { type: "string" },
          currency: { type: "string" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_transfers",
      description: "Find transfer options by destination name/code and passenger count.",
      parameters: {
        type: "object",
        properties: {
          destinationLocationCode: { type: "string" },
          destinationName: { type: "string" },
          transferType: { type: "string", enum: ["INDIVIDUAL", "GROUP"] },
          paxCount: { type: "integer", minimum: 1, maximum: 20 },
          travelDate: { type: "string" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_excursions",
      description: "Load excursion options and optionally filter by keyword or max price.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "integer", minimum: 1, maximum: 30 },
          maxPrice: { type: "number" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_flights",
      description: "Search flydubai flight offers by origin/destination/date.",
      parameters: {
        type: "object",
        properties: {
          origin: { type: "string" },
          destination: { type: "string" },
          departureDate: { type: "string", description: "YYYY-MM-DD" },
          returnDate: { type: "string", description: "YYYY-MM-DD" },
          cabinClass: { type: "string" },
          adults: { type: "integer", minimum: 1, maximum: 9 },
          children: { type: "integer", minimum: 0, maximum: 6 },
          currency: { type: "string" },
        },
        required: ["origin", "destination", "departureDate"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "quote_insurance",
      description:
        "Calculate live EFES insurance premium for travelers. Use when proposing insurance price.",
      parameters: {
        type: "object",
        properties: {
          startDate: { type: "string", description: "YYYY-MM-DD" },
          endDate: { type: "string", description: "YYYY-MM-DD" },
          days: { type: "integer", minimum: 1, maximum: 365 },
          territoryCode: { type: "string" },
          riskAmount: { type: "number" },
          riskCurrency: { type: "string" },
          riskLabel: { type: "string" },
          promoCode: { type: "string" },
          subrisks: {
            type: "array",
            items: { type: "string" },
          },
          travelers: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                age: { type: "integer" },
                passportNumber: { type: "string" },
                socialCard: { type: "string" },
                subrisks: {
                  type: "array",
                  items: { type: "string" },
                },
              },
              required: ["age"],
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
    },
  },
] as const;

const buildSystemPrompt = (
  locale: Locale,
  context: PackageAssistantContext | null,
  projectContext: AssistantProjectContext
) => {
  const language = localeLanguageName[locale] ?? "English";
  return [
    "You are Megatours Concierge AI for premium package building.",
    `Always answer in ${language}.`,
    "Core goals:",
    "- Deliver delightful, high-confidence recommendations that feel personal and decisive.",
    "- Use only verified data from tools for hotels/prices/availability.",
    "- Never invent hotel rates, flight prices, transfer prices, or excursion prices.",
    "- If core inputs are missing, ask concise follow-up questions before finalizing options.",
    "- Never include disabled services in package drafts.",
    "- Personalize suggestions using recent user signals when available.",
    "- If insurance is selected and dates/travelers are known, call quote_insurance before returning insurance price.",
    "When proposing options:",
    "- Provide 1-3 package options max.",
    "- Keep each option clearly differentiated (value, comfort, premium).",
    "- Include practical reasoning and tradeoffs.",
    "- Mark pricing as live and subject to availability.",
    "Output rules:",
    "- Return strict JSON only.",
    "- No markdown, no code fences, no explanations outside JSON.",
    "- JSON schema:",
    "{",
    '  "message": "string",',
    '  "stage": "collecting" | "proposing" | "ready",',
    '  "missing": ["string"],',
    '  "followUps": ["string"],',
    '  "packageOptions": [',
    "    {",
    '      "id": "string",',
    '      "title": "string",',
    '      "summary": "string",',
    '      "confidence": 0.0,',
    '      "approxTotal": { "amount": number|null, "currency": "USD", "note": "string" },',
    '      "highlights": ["string"],',
    '      "draft": {',
    '        "hotel": { "selected": true, "hotelCode": "string", "hotelName": "string", "destinationCode": "string", "destinationName": "string", "checkInDate": "YYYY-MM-DD", "checkOutDate": "YYYY-MM-DD", "roomCount": 1, "guestCount": 2, "price": 1000, "currency": "USD" },',
    '        "transfer": { "selected": true, "selectionId": "string", "label": "string", "price": 40, "currency": "USD", "transferType": "INDIVIDUAL", "vehicleName": "string", "vehicleQuantity": 1, "destinationName": "string", "destinationCode": "string", "paxCount": 2 },',
    '        "flight": { "selected": true, "selectionId": "string", "label": "string", "price": 250, "currency": "USD", "origin": "EVN", "destination": "DXB", "departureDate": "YYYY-MM-DD", "returnDate": "YYYY-MM-DD", "cabinClass": "economy", "notes": "string" },',
    '        "excursion": { "selected": true, "label": "string", "price": 120, "currency": "USD", "items": [ { "id": "string", "name": "string", "price": 60, "currency": "USD" } ] },',
    '        "insurance": { "selected": true, "planId": "string", "planLabel": "string", "price": 40, "currency": "USD", "note": "string", "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD", "days": 5 }',
    "      }",
    "    }",
    "  ]",
    "}",
    "Use null or omit fields when data is unavailable.",
    `Service availability snapshot: ${JSON.stringify(projectContext.serviceFlags)}`,
    `User signals snapshot: ${JSON.stringify(projectContext.userSignals ?? null)}`,
    `Context snapshot: ${JSON.stringify(context ?? {})}`,
  ].join("\n");
};

const sanitizeConversation = (messages: PackageAssistantApiMessage[]): PackageAssistantApiMessage[] =>
  messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      role: message.role,
      content: message.content.trim(),
    }))
    .filter((message) => message.content.length > 0)
    .slice(-MAX_CONVERSATION_MESSAGES);

const parseJsonLike = (raw: string): unknown => {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withoutFence =
    trimmed.startsWith("```") && trimmed.endsWith("```")
      ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim()
      : trimmed;
  try {
    return JSON.parse(withoutFence);
  } catch {
    return null;
  }
};

const normalizeTransferLocation = (value: unknown): AoryxTransferLocation | null => {
  const record = parseRecord(value);
  if (!record) return null;
  return {
    locationCode: toTrimmedString(record.locationCode) ?? null,
    locationType: toTrimmedString(record.locationType) ?? null,
    countryCode: toTrimmedString(record.countryCode) ?? null,
    cityCode: toTrimmedString(record.cityCode) ?? null,
    zoneCode: toTrimmedString(record.zoneCode) ?? null,
    airportCode: toTrimmedString(record.airportCode) ?? null,
    name: toTrimmedString(record.name) ?? null,
  };
};

const normalizeTransferVehicle = (value: unknown): AoryxTransferVehicle | null => {
  const record = parseRecord(value);
  if (!record) return null;
  return {
    code: toTrimmedString(record.code) ?? null,
    category: toTrimmedString(record.category) ?? null,
    name: toTrimmedString(record.name) ?? null,
    maxPax: toFiniteNumber(record.maxPax),
    maxBags: toFiniteNumber(record.maxBags),
  };
};

const normalizeTransferPricing = (value: unknown): AoryxTransferPricing | null => {
  const record = parseRecord(value);
  if (!record) return null;
  return {
    currency: toCurrencyCode(record.currency),
    chargeType:
      toTrimmedString(record.chargeType) === "PER_VEHICLE"
        ? "PER_VEHICLE"
        : toTrimmedString(record.chargeType) === "PER_PAX"
          ? "PER_PAX"
          : null,
    oneWay: toFiniteNumber(record.oneWay),
    return: toFiniteNumber(record.return),
  };
};

const normalizeHotelDraft = (value: unknown): PackageAssistantHotelDraft | undefined => {
  const record = parseRecord(value);
  if (!record) return undefined;
  const selected = toBoolean(record.selected);
  if (selected === false) return undefined;

  const hotelCode = toTrimmedString(record.hotelCode);
  const hotelName = toTrimmedString(record.hotelName);
  const destinationCode = toTrimmedString(record.destinationCode);
  const destinationName = toTrimmedString(record.destinationName);

  if (!hotelCode && !hotelName && !destinationCode && !destinationName) {
    return undefined;
  }

  return {
    selected: true,
    hotelCode,
    hotelName,
    destinationCode,
    destinationName,
    checkInDate: toIsoDate(record.checkInDate),
    checkOutDate: toIsoDate(record.checkOutDate),
    roomCount: toFiniteNumber(record.roomCount),
    guestCount: toFiniteNumber(record.guestCount),
    mealPlan: toTrimmedString(record.mealPlan),
    nonRefundable: toBoolean(record.nonRefundable),
    price: toFiniteNumber(record.price),
    currency: toCurrencyCode(record.currency),
  };
};

const normalizeTransferDraft = (value: unknown): PackageAssistantTransferDraft | undefined => {
  const record = parseRecord(value);
  if (!record) return undefined;
  const selected = toBoolean(record.selected);
  if (selected === false) return undefined;
  const selectionId = toTrimmedString(record.selectionId);
  const label = toTrimmedString(record.label);
  const transferType = toTrimmedString(record.transferType);

  if (!selectionId && !label && !transferType) {
    return undefined;
  }

  const rawChargeType = toTrimmedString(record.chargeType);
  const chargeType: AoryxTransferChargeType | null =
    rawChargeType === "PER_VEHICLE"
      ? "PER_VEHICLE"
      : rawChargeType === "PER_PAX"
        ? "PER_PAX"
        : null;

  return {
    selected: true,
    selectionId,
    label,
    price: toFiniteNumber(record.price),
    currency: toCurrencyCode(record.currency),
    destinationName: toTrimmedString(record.destinationName),
    destinationCode: toTrimmedString(record.destinationCode),
    transferOrigin: toTrimmedString(record.transferOrigin),
    transferDestination: toTrimmedString(record.transferDestination),
    vehicleName: toTrimmedString(record.vehicleName),
    vehicleMaxPax: toFiniteNumber(record.vehicleMaxPax),
    transferType,
    includeReturn: toBoolean(record.includeReturn),
    vehicleQuantity: toFiniteNumber(record.vehicleQuantity),
    origin: normalizeTransferLocation(record.origin),
    destination: normalizeTransferLocation(record.destination),
    vehicle: normalizeTransferVehicle(record.vehicle),
    paxRange: parseRecord(record.paxRange)
      ? {
          minPax: toFiniteNumber(parseRecord(record.paxRange)?.minPax),
          maxPax: toFiniteNumber(parseRecord(record.paxRange)?.maxPax),
        }
      : null,
    pricing: normalizeTransferPricing(record.pricing),
    validity: parseRecord(record.validity)
      ? {
          from: toIsoDate(parseRecord(record.validity)?.from),
          to: toIsoDate(parseRecord(record.validity)?.to),
        }
      : null,
    chargeType,
    paxCount: toFiniteNumber(record.paxCount),
  };
};

const normalizeFlightDraft = (value: unknown): PackageAssistantFlightDraft | undefined => {
  const record = parseRecord(value);
  if (!record) return undefined;
  const selected = toBoolean(record.selected);
  if (selected === false) return undefined;
  const label = toTrimmedString(record.label);
  const origin = toTrimmedString(record.origin);
  const destination = toTrimmedString(record.destination);
  if (!label && !origin && !destination) {
    return undefined;
  }
  return {
    selected: true,
    selectionId: toTrimmedString(record.selectionId),
    label,
    price: toFiniteNumber(record.price),
    currency: toCurrencyCode(record.currency),
    origin,
    destination,
    departureDate: toIsoDate(record.departureDate),
    returnDate: toIsoDate(record.returnDate),
    cabinClass: toTrimmedString(record.cabinClass),
    notes: toTrimmedString(record.notes),
  };
};

const normalizeExcursionDraft = (value: unknown): PackageAssistantDraft["excursion"] | undefined => {
  const record = parseRecord(value);
  if (!record) return undefined;
  const selected = toBoolean(record.selected);
  if (selected === false) return undefined;
  const items = Array.isArray(record.items)
    ? record.items
        .map((entry) => {
          const itemRecord = parseRecord(entry);
          if (!itemRecord) return null;
          const id = toTrimmedString(itemRecord.id);
          if (!id) return null;
          return {
            id,
            name: toTrimmedString(itemRecord.name),
            price: toFiniteNumber(itemRecord.price),
            currency: toCurrencyCode(itemRecord.currency),
          };
        })
        .filter(
          (
            item
          ): item is { id: string; name: string | null; price: number | null; currency: string | null } =>
            Boolean(item)
        )
        .slice(0, 8)
    : [];

  const label = toTrimmedString(record.label);
  if (!label && items.length === 0) return undefined;

  return {
    selected: true,
    label,
    price: toFiniteNumber(record.price),
    currency: toCurrencyCode(record.currency),
    items,
  };
};

const normalizeInsuranceDraft = (value: unknown): PackageAssistantInsuranceDraft | undefined => {
  const record = parseRecord(value);
  if (!record) return undefined;
  const selected = toBoolean(record.selected);
  if (selected === false) return undefined;
  const planId = toTrimmedString(record.planId);
  const planLabel = toTrimmedString(record.planLabel);
  if (!planId && !planLabel) return undefined;
  return {
    selected: true,
    selectionId: toTrimmedString(record.selectionId),
    label: toTrimmedString(record.label),
    price: toFiniteNumber(record.price),
    currency: toCurrencyCode(record.currency),
    planId,
    planLabel,
    note: toTrimmedString(record.note),
    riskAmount: toFiniteNumber(record.riskAmount),
    riskCurrency: toCurrencyCode(record.riskCurrency),
    riskLabel: toTrimmedString(record.riskLabel),
    startDate: toIsoDate(record.startDate),
    endDate: toIsoDate(record.endDate),
    days: toFiniteNumber(record.days),
  };
};

const normalizeDraft = (value: unknown): PackageAssistantDraft => {
  const record = parseRecord(value) ?? {};
  return {
    hotel: normalizeHotelDraft(record.hotel),
    transfer: normalizeTransferDraft(record.transfer),
    flight: normalizeFlightDraft(record.flight),
    excursion: normalizeExcursionDraft(record.excursion),
    insurance: normalizeInsuranceDraft(record.insurance),
  };
};

const normalizeOption = (value: unknown, index: number): PackageAssistantPackageOption | null => {
  const record = parseRecord(value);
  if (!record) return null;
  const draft = normalizeDraft(record.draft);
  if (!draft.hotel && !draft.transfer && !draft.flight && !draft.excursion && !draft.insurance) {
    return null;
  }
  const confidenceRaw = toFiniteNumber(record.confidence);
  return {
    id: toTrimmedString(record.id) ?? `option-${index + 1}`,
    title: toTrimmedString(record.title) ?? `Option ${index + 1}`,
    summary: toTrimmedString(record.summary) ?? "Curated by Megatours Concierge AI.",
    confidence:
      confidenceRaw !== null ? Math.max(0, Math.min(1, Number(confidenceRaw.toFixed(2)))) : null,
    approxTotal: parseRecord(record.approxTotal)
      ? {
          amount: toFiniteNumber(parseRecord(record.approxTotal)?.amount),
          currency: toCurrencyCode(parseRecord(record.approxTotal)?.currency),
          note: toTrimmedString(parseRecord(record.approxTotal)?.note),
        }
      : null,
    highlights: uniqueStrings(toArrayOfStrings(record.highlights, 5), 5),
    draft,
  };
};

const normalizeStage = (value: unknown): PackageAssistantReplyStage => {
  const raw = toTrimmedString(value);
  if (raw === "ready" || raw === "proposing" || raw === "collecting") return raw;
  return "collecting";
};

const normalizeReplyFromModel = (rawContent: string, locale: Locale): PackageAssistantReply => {
  const fallback = buildFallbackReply(locale);
  const parsed = parseJsonLike(rawContent);
  const record = parseRecord(parsed);
  if (!record) return fallback;

  const packageOptionsRaw = Array.isArray(record.packageOptions) ? record.packageOptions : [];
  const packageOptions = packageOptionsRaw
    .map((option, index) => normalizeOption(option, index))
    .filter((option): option is PackageAssistantPackageOption => Boolean(option))
    .slice(0, MAX_PACKAGE_OPTIONS);

  const normalized: PackageAssistantReply = {
    message: toTrimmedString(record.message) ?? fallback.message,
    stage: normalizeStage(record.stage),
    missing: uniqueStrings(toArrayOfStrings(record.missing), 8),
    followUps: uniqueStrings(toArrayOfStrings(record.followUps), 5),
    packageOptions,
  };

  if (normalized.packageOptions.length > 0 && normalized.stage === "collecting") {
    normalized.stage = "proposing";
  }
  if (normalized.stage === "ready" && normalized.packageOptions.length === 0) {
    normalized.stage = "collecting";
  }

  return normalized;
};

const parseToolArgs = (value: string): Record<string, unknown> => {
  if (!value || value.trim().length === 0) return {};
  try {
    const parsed = JSON.parse(value);
    return parseRecord(parsed) ?? {};
  } catch {
    return {};
  }
};

const executeLookupDestinations = async (
  args: Record<string, unknown>
): Promise<ToolExecutionResult> => {
  const query = toTrimmedString(args.query) ?? undefined;
  const countryCode = toTrimmedString(args.countryCode)?.toUpperCase() ?? "AE";
  const limit = clampInteger(args.limit, 1, 30, 12);

  try {
    const result = await listAoryxDestinations({
      q: query,
      countryCode,
      limit,
    });
    return {
      ok: true,
      tool: "lookup_destinations",
      data: {
        countryCode: result.countryCode,
        destinations: result.destinations.slice(0, limit).map((destination) => ({
          destinationCode: destination.destinationCode,
          name: destination.name,
        })),
      },
    };
  } catch (error) {
    return {
      ok: false,
      tool: "lookup_destinations",
      error: resolveSafeErrorMessage(
        error instanceof Error ? error.message : null,
        "Failed to fetch destinations."
      ),
    };
  }
};

const executeSearchHotels = async (
  args: Record<string, unknown>,
  context: PackageAssistantContext | null
): Promise<ToolExecutionResult> => {
  const destinationCode = toTrimmedString(args.destinationCode) ?? context?.destinationCode ?? null;
  const hotelCode = toTrimmedString(args.hotelCode);
  const checkInDate = toIsoDate(args.checkInDate) ?? toIsoDate(context?.checkInDate);
  const checkOutDate = toIsoDate(args.checkOutDate) ?? toIsoDate(context?.checkOutDate);
  const roomCount = clampInteger(args.roomCount ?? context?.roomCount, 1, 4, 1);
  const adults = clampInteger(args.adults ?? context?.adults, 1, 12, 2);
  const children = clampInteger(args.children ?? context?.children, 0, 8, 0);
  const currency = toCurrencyCode(args.currency) ?? toCurrencyCode(context?.budgetCurrency) ?? "USD";
  const countryCode = toTrimmedString(args.countryCode)?.toUpperCase() ?? "AE";
  const nationality = toTrimmedString(args.nationality)?.toUpperCase() ?? "AM";

  if (!checkInDate || !checkOutDate || (!destinationCode && !hotelCode)) {
    return {
      ok: false,
      tool: "search_hotels",
      error:
        "Missing required inputs for hotel search. Need checkInDate, checkOutDate and destinationCode/hotelCode.",
    };
  }

  try {
    const result = await runAoryxSearch({
      destinationCode: destinationCode ?? undefined,
      hotelCode: hotelCode ?? undefined,
      countryCode,
      nationality,
      checkInDate,
      checkOutDate,
      currency,
      rooms: buildRooms(adults, children, roomCount),
    });

    return {
      ok: true,
      tool: "search_hotels",
      data: {
        query: {
          destinationCode,
          hotelCode,
          checkInDate,
          checkOutDate,
          roomCount,
          adults,
          children,
          currency,
        },
        destination: result.destination,
        propertyCount: result.propertyCount,
        hotels: result.hotels.slice(0, 12).map((hotel) => ({
          code: hotel.code,
          name: hotel.name,
          city: hotel.city,
          rating: hotel.rating,
          minPrice: hotel.minPrice,
          currency: hotel.currency ?? result.currency,
        })),
      },
    };
  } catch (error) {
    return {
      ok: false,
      tool: "search_hotels",
      error: resolveSafeErrorMessage(
        error instanceof Error ? error.message : null,
        "Hotel search failed."
      ),
    };
  }
};

const buildTransferId = (
  value: {
    _id?: string | null;
    transferType?: string | null;
    destination?: { locationCode?: string | null; name?: string | null } | null;
    vehicle?: { name?: string | null; category?: string | null } | null;
  },
  index: number
) =>
  value._id ??
  [
    value.transferType ?? "transfer",
    value.destination?.locationCode ?? value.destination?.name ?? "destination",
    value.vehicle?.name ?? value.vehicle?.category ?? "vehicle",
    index + 1,
  ].join("-");

const executeSearchTransfers = async (
  args: Record<string, unknown>,
  context: PackageAssistantContext | null
): Promise<ToolExecutionResult> => {
  const destinationLocationCode = toTrimmedString(args.destinationLocationCode);
  const destinationName = toTrimmedString(args.destinationName) ?? context?.destinationName ?? null;
  const transferType = toTrimmedString(args.transferType)?.toUpperCase() ?? null;
  const paxCount = clampInteger(
    args.paxCount ?? context?.adults ?? 2,
    1,
    20,
    Math.max(1, context?.adults ?? 2)
  );
  const travelDate = toIsoDate(args.travelDate) ?? toIsoDate(context?.checkInDate);

  if (!destinationLocationCode && !destinationName) {
    return {
      ok: false,
      tool: "search_transfers",
      error: "Missing destinationName or destinationLocationCode.",
    };
  }

  try {
    const transfers = await fetchTransferRates({
      destinationLocationCode: destinationLocationCode ?? undefined,
      destinationName: destinationName ?? undefined,
      transferType: transferType ?? undefined,
      paxCount,
      travelDate: travelDate ?? undefined,
    });

    return {
      ok: true,
      tool: "search_transfers",
      data: {
        count: transfers.length,
        transfers: transfers.slice(0, 16).map((transfer, index) => ({
          id: buildTransferId(transfer, index),
          transferType: transfer.transferType ?? null,
          origin: transfer.origin ?? null,
          destination: transfer.destination ?? null,
          vehicle: transfer.vehicle ?? null,
          paxRange: transfer.paxRange ?? null,
          pricing: transfer.pricing ?? null,
          validity: transfer.validity ?? null,
        })),
      },
    };
  } catch (error) {
    return {
      ok: false,
      tool: "search_transfers",
      error: resolveSafeErrorMessage(
        error instanceof Error ? error.message : null,
        "Transfer lookup failed."
      ),
    };
  }
};

const executeSearchExcursions = async (
  args: Record<string, unknown>
): Promise<ToolExecutionResult> => {
  const query = toTrimmedString(args.query)?.toLowerCase() ?? null;
  const maxPrice = toFiniteNumber(args.maxPrice);
  const limit = clampInteger(args.limit, 1, 30, 12);

  try {
    const sourceLimit = Math.max(limit * 3, 60);
    const { excursions, excursionFee } = await fetchExcursions(sourceLimit);
    const filtered = excursions.filter((excursion) => {
      if (query) {
        const haystack = [
          excursion.name,
          excursion.description,
          excursion.productType,
          excursion.location,
        ]
          .filter((entry): entry is string => Boolean(entry))
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      if (typeof maxPrice === "number" && Number.isFinite(maxPrice)) {
        const adultPrice = toFiniteNumber(excursion.pricing?.adult);
        if (adultPrice !== null && adultPrice > maxPrice) return false;
      }
      return true;
    });

    return {
      ok: true,
      tool: "search_excursions",
      data: {
        count: filtered.length,
        excursionFee,
        excursions: filtered.slice(0, limit).map((excursion) => ({
          id: excursion._id ?? excursion.activityCode ?? excursion.name ?? "",
          name: excursion.name ?? null,
          productType: excursion.productType ?? null,
          pricing: {
            adult: toFiniteNumber(excursion.pricing?.adult),
            child: toFiniteNumber(excursion.pricing?.child),
            currency: toCurrencyCode(excursion.pricing?.currency),
          },
          childPolicy: excursion.childPolicy ?? null,
          validity: excursion.validity ?? null,
        })),
      },
    };
  } catch (error) {
    return {
      ok: false,
      tool: "search_excursions",
      error: resolveSafeErrorMessage(
        error instanceof Error ? error.message : null,
        "Excursion lookup failed."
      ),
    };
  }
};

const executeSearchFlights = async (
  args: Record<string, unknown>
): Promise<ToolExecutionResult> => {
  const origin = toTrimmedString(args.origin)?.toUpperCase() ?? null;
  const destination = toTrimmedString(args.destination)?.toUpperCase() ?? null;
  const departureDate = toIsoDate(args.departureDate);
  const returnDate = toIsoDate(args.returnDate);
  const cabinClass = toTrimmedString(args.cabinClass);
  const adults = clampInteger(args.adults, 1, 9, 1);
  const children = clampInteger(args.children, 0, 6, 0);
  const currency = toCurrencyCode(args.currency);

  if (!origin || !destination || !departureDate) {
    return {
      ok: false,
      tool: "search_flights",
      error: "Missing origin, destination or departureDate.",
    };
  }

  const payload: FlydubaiSearchRequest = {
    origin,
    destination,
    departureDate,
    returnDate: returnDate ?? null,
    cabinClass: cabinClass ?? null,
    adults,
    children,
    currency: currency ?? null,
  };

  try {
    const result = await searchFlydubai(payload, { allowMock: true });
    return {
      ok: true,
      tool: "search_flights",
      data: {
        currency: result.currency,
        mock: result.mock ?? false,
        offers: result.offers.slice(0, 8).map((offer) => ({
          id: offer.id,
          totalPrice: offer.totalPrice,
          currency: offer.currency,
          cabinClass: offer.cabinClass ?? null,
          refundable: offer.refundable ?? null,
          outbound: offer.segments,
          inbound: offer.returnSegments ?? null,
        })),
      },
    };
  } catch (error) {
    return {
      ok: false,
      tool: "search_flights",
      error: resolveSafeErrorMessage(
        error instanceof Error ? error.message : null,
        "Flight lookup failed."
      ),
    };
  }
};

const executeQuoteInsurance = async (
  args: Record<string, unknown>,
  context: PackageAssistantContext | null
): Promise<ToolExecutionResult> => {
  const startDate = toIsoDate(args.startDate) ?? toIsoDate(context?.checkInDate);
  const endDate = toIsoDate(args.endDate) ?? toIsoDate(context?.checkOutDate);
  const days = toSafeInteger(args.days);
  const territoryCode =
    toTrimmedString(args.territoryCode) ?? DEFAULT_INSURANCE_TERRITORY_CODE;
  const riskAmount =
    toFiniteNumber(args.riskAmount) ?? DEFAULT_INSURANCE_RISK_AMOUNT;
  const riskCurrency =
    toCurrencyCode(args.riskCurrency) ?? DEFAULT_INSURANCE_RISK_CURRENCY;
  const riskLabel =
    toTrimmedString(args.riskLabel) ?? DEFAULT_INSURANCE_RISK_LABEL;
  const promoCode = toTrimmedString(args.promoCode);
  const subrisks = uniqueStrings(toArrayOfStrings(args.subrisks, 12), 12);
  const explicitTravelers = normalizeInsuranceTravelersArg(args.travelers);
  const fallbackTravelers = buildInsuranceTravelersFromContext(context);
  const travelers =
    explicitTravelers.length > 0 ? explicitTravelers : fallbackTravelers;

  if (!startDate || !endDate) {
    return {
      ok: false,
      tool: "quote_insurance",
      error: "Missing startDate/endDate for insurance quote.",
    };
  }

  if (travelers.length === 0) {
    return {
      ok: false,
      tool: "quote_insurance",
      error: "Missing travelers for insurance quote.",
    };
  }

  try {
    const quote = await quoteEfesTravelCost({
      startDate,
      endDate,
      days: days ?? undefined,
      territoryCode,
      riskAmount,
      riskCurrency,
      riskLabel,
      promoCode: promoCode ?? undefined,
      travelers,
      subrisks: subrisks.length > 0 ? subrisks : undefined,
    });

    return {
      ok: true,
      tool: "quote_insurance",
      data: {
        query: {
          startDate,
          endDate,
          days: days ?? null,
          territoryCode,
          riskAmount,
          riskCurrency,
          riskLabel,
          travelerCount: travelers.length,
          subrisks,
        },
        quote: {
          totalPremium: quote.totalPremium,
          currency: quote.currency,
          sum: quote.sum ?? null,
          discountedSum: quote.discountedSum ?? null,
          premiums: quote.premiums.map((entry) => ({
            travelerId: entry.travelerId ?? null,
            premium: entry.premium,
          })),
        },
      },
    };
  } catch (error) {
    return {
      ok: false,
      tool: "quote_insurance",
      error: resolveSafeErrorMessage(
        error instanceof Error ? error.message : null,
        "Insurance quote failed."
      ),
    };
  }
};

const executeToolCall = async (
  toolCall: OpenAiToolCall,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> => {
  const args = parseToolArgs(toolCall.function.arguments);
  switch (toolCall.function.name) {
    case "lookup_destinations":
      return executeLookupDestinations(args);
    case "search_hotels":
      return executeSearchHotels(args, context.context);
    case "search_transfers":
      return executeSearchTransfers(args, context.context);
    case "search_excursions":
      return executeSearchExcursions(args);
    case "search_flights":
      return executeSearchFlights(args);
    case "quote_insurance":
      return executeQuoteInsurance(args, context.context);
    default:
      return {
        ok: false,
        tool: toolCall.function.name,
        error: `Unknown tool: ${toolCall.function.name}`,
      };
  }
};

const appendToolPriceEvidence = (
  evidence: ToolPriceEvidence,
  toolResult: ToolExecutionResult
) => {
  if (!toolResult.ok) return;
  const record = parseRecord(toolResult.data);
  if (!record) return;

  if (toolResult.tool === "search_hotels") {
    const hotels = Array.isArray(record.hotels) ? record.hotels : [];
    hotels.forEach((hotel) => {
      const hotelRecord = parseRecord(hotel);
      if (!hotelRecord) return;
      evidence.hotels.push({
        hotelCode: toTrimmedString(hotelRecord.code),
        hotelName: toTrimmedString(hotelRecord.name),
        price: toFiniteNumber(hotelRecord.minPrice),
        currency: toCurrencyCode(hotelRecord.currency),
      });
    });
    return;
  }

  if (toolResult.tool === "search_transfers") {
    const transfers = Array.isArray(record.transfers) ? record.transfers : [];
    transfers.forEach((transfer) => {
      const transferRecord = parseRecord(transfer);
      if (!transferRecord) return;
      const pricingRecord = parseRecord(transferRecord.pricing);
      const vehicleRecord = parseRecord(transferRecord.vehicle);
      evidence.transfers.push({
        id: toTrimmedString(transferRecord.id),
        transferType: toTrimmedString(transferRecord.transferType),
        vehicleName: toTrimmedString(vehicleRecord?.name),
        oneWay: toFiniteNumber(pricingRecord?.oneWay),
        returnPrice: toFiniteNumber(pricingRecord?.return),
        currency: toCurrencyCode(pricingRecord?.currency),
      });
    });
    return;
  }

  if (toolResult.tool === "search_flights") {
    const offers = Array.isArray(record.offers) ? record.offers : [];
    offers.forEach((offer) => {
      const offerRecord = parseRecord(offer);
      if (!offerRecord) return;
      const outbound = Array.isArray(offerRecord.outbound) ? offerRecord.outbound : [];
      const inbound = Array.isArray(offerRecord.inbound) ? offerRecord.inbound : [];
      const firstOutbound = parseRecord(outbound[0]);
      const firstInbound = parseRecord(inbound[0]);
      const outboundDate = toTrimmedString(firstOutbound?.departureDateTime)?.slice(0, 10) ?? null;
      const inboundDate = toTrimmedString(firstInbound?.departureDateTime)?.slice(0, 10) ?? null;
      evidence.flights.push({
        id: toTrimmedString(offerRecord.id) ?? "",
        totalPrice: toFiniteNumber(offerRecord.totalPrice),
        currency: toCurrencyCode(offerRecord.currency),
        origin: toTrimmedString(firstOutbound?.origin),
        destination: toTrimmedString(firstOutbound?.destination),
        departureDate: outboundDate,
        returnDate: inboundDate,
      });
    });
    return;
  }

  if (toolResult.tool === "search_excursions") {
    const excursions = Array.isArray(record.excursions) ? record.excursions : [];
    excursions.forEach((excursion) => {
      const excursionRecord = parseRecord(excursion);
      if (!excursionRecord) return;
      const pricingRecord = parseRecord(excursionRecord.pricing);
      evidence.excursions.push({
        id: toTrimmedString(excursionRecord.id),
        name: toTrimmedString(excursionRecord.name),
        adultPrice: toFiniteNumber(pricingRecord?.adult),
        childPrice: toFiniteNumber(pricingRecord?.child),
        currency: toCurrencyCode(pricingRecord?.currency),
      });
    });
    return;
  }

  if (toolResult.tool === "quote_insurance") {
    const query = parseRecord(record.query);
    const quote = parseRecord(record.quote);
    evidence.insurances.push({
      totalPremium: toFiniteNumber(quote?.totalPremium),
      currency: toCurrencyCode(quote?.currency),
      startDate: toIsoDate(query?.startDate),
      endDate: toIsoDate(query?.endDate),
      days: toSafeInteger(query?.days),
      territoryCode: toTrimmedString(query?.territoryCode),
      riskAmount: toFiniteNumber(query?.riskAmount),
      riskCurrency: toCurrencyCode(query?.riskCurrency),
      travelerCount: toSafeInteger(query?.travelerCount),
    });
  }
};

const runOpenAiCompletion = async (
  model: string,
  messages: OpenAiMessage[]
): Promise<OpenAiCompletionPayload> => {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is missing");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  try {
    const body: Record<string, unknown> = {
      model,
      temperature: 0.35,
      top_p: 0.95,
      messages,
      tools: toolDefinitions,
      tool_choice: "auto",
      response_format: { type: "json_object" },
    };
    const response = await fetch(OPENAI_BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(`OpenAI error ${response.status}: ${errorBody}`);
    }

    return (await response.json()) as OpenAiCompletionPayload;
  } finally {
    clearTimeout(timeoutId);
  }
};

const runOpenAiWithFallback = async (
  messages: OpenAiMessage[]
): Promise<{ payload: OpenAiCompletionPayload; model: string }> => {
  const candidates = Array.from(
    new Set([OPENAI_PACKAGE_MODEL_PRIMARY, OPENAI_PACKAGE_MODEL_FALLBACK].filter(Boolean))
  );
  let lastError: unknown = null;

  for (const model of candidates) {
    try {
      const payload = await runOpenAiCompletion(model, messages);
      return { payload, model };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("OpenAI request failed");
};

export async function generatePackageAssistantReply(
  input: AssistantGenerationInput
): Promise<AssistantGenerationOutput> {
  const locale = input.locale;
  const context = input.context ?? null;
  const userId = toTrimmedString(input.userId) ?? null;
  const onProgress = input.onProgress;
  const sanitizedMessages = sanitizeConversation(input.messages);
  const fallback = buildFallbackReply(locale);
  const emptyAudit: PackageAssistantPriceAudit = {
    status: "pass",
    issues: [],
    checkedAt: new Date().toISOString(),
  };
  const projectContext = await loadAssistantProjectContext(userId);

  if (sanitizedMessages.length === 0) {
    return {
      reply: applyServiceAvailabilityToReply(
        fallback,
        projectContext.serviceFlags,
        locale
      ),
      meta: { model: "fallback", toolCalls: 0, priceAudit: emptyAudit },
    };
  }

  if (!OPENAI_API_KEY) {
    const unavailableReply = applyServiceAvailabilityToReply(
      {
        ...fallback,
        message:
          locale === "ru"
            ? "AI временно недоступен. Напишите направление, даты и бюджет, и менеджер поможет вручную."
            : locale === "hy"
              ? "AI-ը ժամանակավորապես հասանելի չէ։ Գրեք ուղղությունը, ամսաթվերը և բյուջեն, և մենեջերը կօգնի։"
              : "AI is temporarily unavailable. Share destination, dates and budget, and our manager can assist.",
      },
      projectContext.serviceFlags,
      locale
    );
    return {
      reply: unavailableReply,
      meta: { model: "unconfigured", toolCalls: 0, priceAudit: emptyAudit },
    };
  }

  const openAiMessages: OpenAiMessage[] = [
    {
      role: "system",
      content: buildSystemPrompt(locale, context, projectContext),
    },
    ...sanitizedMessages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
  ];

  let usedModel = OPENAI_PACKAGE_MODEL_PRIMARY;
  let toolCallsCount = 0;
  const priceEvidence = createToolPriceEvidence();

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    if (onProgress) {
      await onProgress({
        type: "model_start",
        model: usedModel,
        round: round + 1,
      });
    }

    const completion = await runOpenAiWithFallback(openAiMessages);
    usedModel = completion.model;
    const nextMessage = completion.payload.choices?.[0]?.message;
    if (!nextMessage) {
      break;
    }

    const toolCalls = Array.isArray(nextMessage.tool_calls) ? nextMessage.tool_calls : [];
    if (toolCalls.length > 0) {
      openAiMessages.push({
        role: "assistant",
        content: nextMessage.content ?? "",
        tool_calls: toolCalls,
      });
      if (onProgress) {
        for (const toolCall of toolCalls) {
          await onProgress({
            type: "tool_call",
            tool: toolCall.function.name,
          });
        }
      }
      const toolResults = await Promise.all(
        toolCalls.map((toolCall) =>
          executeToolCall(toolCall, {
            locale,
            context,
          })
        )
      );
      toolCallsCount += toolResults.length;
      for (let index = 0; index < toolResults.length; index += 1) {
        const toolResult = toolResults[index];
        appendToolPriceEvidence(priceEvidence, toolResult);
        if (onProgress) {
          await onProgress({
            type: "tool_result",
            tool: toolResult.tool,
            ok: toolResult.ok,
          });
        }
        const toolCall = toolCalls[index];
        if (!toolCall) continue;
        openAiMessages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(toolResult),
        });
      }
      continue;
    }

    if (onProgress) {
      await onProgress({
        type: "finalizing",
      });
    }
    const normalized = normalizeReplyFromModel(nextMessage.content ?? "", locale);
    const restricted = applyServiceAvailabilityToReply(
      normalized,
      projectContext.serviceFlags,
      locale
    );
    const audited = applyHardPriceAudit(restricted, priceEvidence);
    return {
      reply: audited.reply,
      meta: {
        model: usedModel,
        toolCalls: toolCallsCount,
        priceAudit: audited.audit,
      },
    };
  }

  const restrictedFallback = applyServiceAvailabilityToReply(
    fallback,
    projectContext.serviceFlags,
    locale
  );
  const auditedFallback = applyHardPriceAudit(restrictedFallback, priceEvidence);
  return {
    reply: auditedFallback.reply,
    meta: {
      model: usedModel,
      toolCalls: toolCallsCount,
      priceAudit: auditedFallback.audit,
    },
  };
}

export async function persistPackageAssistantTurn(input: AssistantPersistenceInput) {
  try {
    const db = await getDb();
    const now = new Date();
    const userId = toTrimmedString(input.userId) ?? null;
    const sessionCollection = db.collection<{ _id: string; [key: string]: unknown }>(
      "package_assistant_sessions"
    );
    const messageCollection = db.collection<Record<string, unknown>>(
      "package_assistant_messages"
    );

    await sessionCollection.updateOne(
      { _id: input.sessionId },
      {
        $set: {
          locale: input.locale,
          userId: userId ?? null,
          context: input.context ?? null,
          updatedAt: now,
          lastModel: input.model,
          lastToolCalls: input.toolCalls,
          lastStage: input.reply.stage,
          lastMissing: input.reply.missing,
          lastPackageOptions: input.reply.packageOptions.length,
          lastPriceAuditStatus: input.priceAudit.status,
          lastPriceAuditIssues: input.priceAudit.issues.length,
          lastPriceAudit: input.priceAudit,
        },
        $setOnInsert: {
          createdAt: now,
        },
      },
      { upsert: true }
    );

    const entries: Array<Record<string, unknown>> = [];
    if (input.userMessage) {
      entries.push({
        sessionId: input.sessionId,
        role: "user",
        content: input.userMessage,
        createdAt: now,
      });
    }
    entries.push({
      sessionId: input.sessionId,
      role: "assistant",
      content: input.reply.message,
      stage: input.reply.stage,
      missing: input.reply.missing,
      followUps: input.reply.followUps,
      packageOptions: input.reply.packageOptions,
      model: input.model,
      toolCalls: input.toolCalls,
      priceAudit: input.priceAudit,
      createdAt: now,
    });
    if (entries.length > 0) {
      await messageCollection.insertMany(entries);
    }
  } catch (error) {
    console.error("[PackageAssistant] Failed to persist chat turn", error);
  }
}
