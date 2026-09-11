import type { BookingInsuranceSelection, BookingInsuranceTraveler } from "../types/aoryx";
import type { EfesQuoteRequest, EfesQuoteResult } from "../types/efes";

type InsuranceQuoteSource = Pick<
  BookingInsuranceSelection,
  | "startDate"
  | "endDate"
  | "days"
  | "territoryCode"
  | "riskAmount"
  | "riskCurrency"
  | "riskLabel"
  | "subrisks"
  | "riskByGuest"
  | "travelers"
>;

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const EFES_MAX_INSURANCE_AGE_YEARS = 100;

export const resolveEfesInsuranceAgeMultiplier = (age: number | null | undefined) => {
  if (
    typeof age !== "number" ||
    !Number.isInteger(age) ||
    age < 0 ||
    age > EFES_MAX_INSURANCE_AGE_YEARS
  ) {
    return null;
  }
  if (age >= 95) return 5;
  if (age >= 85) return 4;
  if (age >= 75) return 3;
  if (age >= 65) return 2;
  return 1;
};

const parseIsoDate = (value: string | null | undefined) => {
  const match = value?.trim().match(ISO_DATE_RE);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
};

export const calculateEfesInsuranceAge = (
  birthDate: string | null | undefined,
  travelStartDate: string | null | undefined
) => {
  const birth = parseIsoDate(birthDate);
  const start = parseIsoDate(travelStartDate);
  if (!birth || !start || birth.getTime() > start.getTime()) return null;
  let age = start.getUTCFullYear() - birth.getUTCFullYear();
  const birthdayPassed =
    start.getUTCMonth() > birth.getUTCMonth() ||
    (start.getUTCMonth() === birth.getUTCMonth() && start.getUTCDate() >= birth.getUTCDate());
  if (!birthdayPassed) age -= 1;
  return age >= 0 ? age : null;
};

export const buildEfesInsuranceQuoteRequest = (
  insurance: InsuranceQuoteSource,
  fallbackDates: { startDate?: string | null; endDate?: string | null } = {}
): EfesQuoteRequest => {
  const startDate = insurance.startDate?.trim() || fallbackDates.startDate?.trim() || "";
  const endDate = insurance.endDate?.trim() || fallbackDates.endDate?.trim() || "";
  const territoryCode = insurance.territoryCode?.trim() || "";
  const riskAmount = insurance.riskAmount;
  const riskCurrency = insurance.riskCurrency?.trim() || "";
  const travelers = insurance.travelers ?? [];

  if (!startDate || !endDate) throw new Error("Missing travel dates for EFES quote.");
  const parsedStartDate = parseIsoDate(startDate);
  const parsedEndDate = parseIsoDate(endDate);
  if (!parsedStartDate || !parsedEndDate || parsedEndDate.getTime() < parsedStartDate.getTime()) {
    throw new Error("Invalid travel dates for EFES quote.");
  }
  if (!territoryCode) throw new Error("Missing insurance territory for EFES quote.");
  if (typeof riskAmount !== "number" || !Number.isFinite(riskAmount) || riskAmount <= 0) {
    throw new Error("Missing insurance coverage amount for EFES quote.");
  }
  if (!riskCurrency) throw new Error("Missing insurance coverage currency for EFES quote.");
  if (travelers.length === 0) throw new Error("Missing travelers for EFES quote.");

  return {
    startDate,
    endDate,
    days:
      Math.ceil((parsedEndDate.getTime() - parsedStartDate.getTime()) / (1000 * 60 * 60 * 24)) + 1,
    territoryCode,
    riskAmount,
    riskCurrency,
    riskLabel: insurance.riskLabel,
    subrisks: insurance.subrisks,
    travelers: travelers.map((traveler, index) => {
      const age = calculateEfesInsuranceAge(traveler.birthDate, startDate);
      if (age === null) {
        throw new Error(`Traveler ${index + 1} has an invalid birth date for the insurance trip.`);
      }
      const travelerId = traveler.id?.trim() || null;
      const travelerRisk = travelerId ? insurance.riskByGuest?.[travelerId] : null;
      return {
        id: travelerId,
        age,
        passportNumber: traveler.passportNumber,
        socialCard: traveler.socialCard,
        riskAmount:
          typeof travelerRisk === "number" && Number.isFinite(travelerRisk) && travelerRisk > 0
            ? travelerRisk
            : traveler.riskAmount,
        riskCurrency: traveler.riskCurrency ?? insurance.riskCurrency,
        riskLabel: traveler.riskLabel ?? insurance.riskLabel,
        subrisks: traveler.subrisks ?? insurance.subrisks,
      };
    }),
  };
};

export const applyEfesInsuranceQuote = (
  insurance: BookingInsuranceSelection,
  quote: EfesQuoteResult
): BookingInsuranceSelection => {
  if (!Number.isFinite(quote.totalPremium) || quote.totalPremium <= 0 || !quote.currency.trim()) {
    throw new Error("EFES returned an invalid insurance total.");
  }
  const travelers = insurance.travelers ?? [];
  const premiumsById = new Map(
    quote.premiums.flatMap((entry) =>
      entry.travelerId && Number.isFinite(entry.premium) && entry.premium > 0
        ? [[entry.travelerId, entry.premium] as const]
        : []
    )
  );
  const updatedTravelers: BookingInsuranceTraveler[] = travelers.map((traveler, index) => {
    const travelerId = traveler.id?.trim() || null;
    const premium =
      (travelerId ? premiumsById.get(travelerId) : undefined) ?? quote.premiums[index]?.premium;
    if (typeof premium !== "number" || !Number.isFinite(premium) || premium <= 0) {
      throw new Error(`EFES did not return a valid premium for traveler ${index + 1}.`);
    }
    return {
      ...traveler,
      premium,
      policyPremium: premium,
      premiumCurrency: quote.currency,
    };
  });

  return {
    ...insurance,
    price: quote.totalPremium,
    currency: quote.currency,
    travelers: updatedTravelers,
  };
};
