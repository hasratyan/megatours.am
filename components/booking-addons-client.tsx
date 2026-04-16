"use client";

import type { FormEvent } from "react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLanguage } from "@/components/language-provider";
import { ApiError, postJson } from "@/lib/api-helpers";
import type {
  BookingAddonHotelContext,
  BookingAddonServiceKey as AddonServiceKey,
} from "@/lib/booking-addons";
import { formatCurrencyAmount, normalizeAmount } from "@/lib/currency";
import { resolveSafeErrorFromUnknown } from "@/lib/error-utils";
import type { CheckoutPaymentMethod, PaymentMethodFlags } from "@/lib/payment-method-flags";
import {
  PACKAGE_BUILDER_SESSION_MS,
  readPackageBuilderState,
  subscribePackageBuilderState,
  updatePackageBuilderState,
  type PackageBuilderState,
} from "@/lib/package-builder-state";
import { useAmdRates } from "@/lib/use-amd-rates";
import type { BookingInsuranceTraveler } from "@/types/aoryx";

type TransferFlightDetailsForm = {
  flightNumber: string;
  arrivalDateTime: string;
  departureFlightNumber: string;
  departureDateTime: string;
};

type TransferFlightFieldErrors = Partial<Record<keyof TransferFlightDetailsForm, string>>;

type IdramCheckoutResponse = {
  action: string;
  fields: Record<string, string>;
  billNo: string;
};

type VposCheckoutResponse = {
  formUrl: string;
  orderId: string;
  orderNumber: string;
};

type BookingAddonPaymentSnapshot = {
  at: string | null;
  provider: string | null;
  amountValue: number | null;
  currency: string | null;
  requestedServices: AddonServiceKey[];
  appliedServices: AddonServiceKey[];
  skippedServices: AddonServiceKey[];
};

type BookingAddonsClientProps = {
  bookingId: string;
  voucherHref: string;
  hotelContext: BookingAddonHotelContext;
  existingServices: AddonServiceKey[];
  serviceFlags: Record<AddonServiceKey, boolean>;
  paymentMethodFlags: PaymentMethodFlags;
  lastAddonPayment: BookingAddonPaymentSnapshot | null;
};

type ServiceCardDefinition = {
  key: AddonServiceKey;
  label: string;
  description: string;
  icon: string;
  href: string;
};

type SelectedServiceCard = {
  id: AddonServiceKey;
  label: string;
  price: string | null;
  active: boolean;
  icon: string;
  ready: boolean;
  statusLabel: string;
  statusTone: "selected" | "warning";
};

type InsuranceTravelerForm = BookingInsuranceTraveler & {
  id: string;
  age: number;
  type: "Adult" | "Child";
};

type InsuranceTravelerFieldErrors = {
  birthDate?: string;
  passportIssueDate?: string;
  passportExpiryDate?: string;
};

const intlLocales = {
  hy: "hy-AM",
  en: "en-GB",
  ru: "ru-RU",
} as const;

const paymentMethodOrder: CheckoutPaymentMethod[] = ["idram", "idbank_card", "ameria_card"];
const addonServiceKeys: AddonServiceKey[] = ["transfer", "excursion", "insurance", "flight"];
const DEFAULT_INSURANCE_ADULT_AGE = 30;
const DEFAULT_INSURANCE_CHILD_AGE = 8;
const MAX_INSURANCE_AGE_YEARS = 100;
const MAX_INSURANCE_CHILD_AGE_YEARS = 18;
const ISO_DATE_INPUT_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const serviceIconMap: Record<AddonServiceKey, string> = {
  transfer: "directions_car",
  excursion: "tour",
  insurance: "shield_with_heart",
  flight: "flight",
};

const isAddonServiceKey = (value: unknown): value is AddonServiceKey =>
  value === "transfer" || value === "excursion" || value === "insurance" || value === "flight";

const mergeUniqueServiceKeys = (
  current: AddonServiceKey[],
  next: AddonServiceKey[]
): AddonServiceKey[] => Array.from(new Set([...current, ...next]));

const normalizeTransferType = (
  value: string | null | undefined
): "INDIVIDUAL" | "GROUP" | undefined => {
  const normalized = value?.trim().toUpperCase();
  if (normalized === "INDIVIDUAL" || normalized === "GROUP") return normalized;
  return undefined;
};

const resolveMethodPayLabel = (
  method: CheckoutPaymentMethod,
  t: ReturnType<typeof useLanguage>["t"]
) => {
  if (method === "idram") return t.packageBuilder.checkout.payIdram;
  if (method === "ameria_card") return t.packageBuilder.checkout.payCardAmeria;
  return t.packageBuilder.checkout.payCard;
};

const monthLabels = {
  hy: ["հնվ", "փտր", "մրտ", "ապր", "մյս", "հնս", "հլս", "օգս", "սեպ", "հոկ", "նոյ", "դեկ"],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  ru: ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"],
} as const;

const resolveDateParts = (value: string | null | undefined) => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || !Number.isFinite(day)) return null;
  if (monthIndex < 0 || monthIndex > 11 || day < 1 || day > 31) return null;
  return { year, monthIndex, day };
};

const resolveDateLabel = (value: string | null | undefined, locale: keyof typeof monthLabels) => {
  const parts = resolveDateParts(value);
  if (!parts) {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }
  const months = monthLabels[locale] ?? monthLabels.en;
  return `${parts.day} ${months[parts.monthIndex]}, ${parts.year}`;
};

const resolveApiServiceKeys = (error: ApiError): AddonServiceKey[] => {
  if (!Array.isArray(error.data?.services)) return [];
  return Array.from(new Set(error.data.services.filter(isAddonServiceKey)));
};

const normalizeOptional = (value: string | null | undefined) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const formatDateInput = (date: Date) => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const addYearsToDateInput = (value: string, years: number) => {
  const [yearRaw, monthRaw, dayRaw] = value.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  const base = new Date(Date.UTC(year + years, month - 1, day));
  if (Number.isNaN(base.getTime())) return null;
  if (base.getUTCMonth() !== month - 1) {
    const lastDay = new Date(Date.UTC(year + years, month, 0));
    return formatDateInput(lastDay);
  }
  return formatDateInput(base);
};

const parseDateInput = (value?: string | null) => {
  if (!value) return null;
  const normalizedValue = value.trim();
  if (!ISO_DATE_INPUT_REGEX.test(normalizedValue)) return null;
  const [yearRaw, monthRaw, dayRaw] = normalizedValue.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return null;
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
};

const getTodayDateInput = () => formatDateInput(new Date());

const calculateAgeFromBirthDate = (birthDate?: string | null, referenceDate?: string | null) => {
  const birth = parseDateInput(birthDate);
  if (!birth) return null;
  const reference = parseDateInput(referenceDate) ?? new Date();
  let age = reference.getUTCFullYear() - birth.getUTCFullYear();
  const birthdayPassed =
    reference.getUTCMonth() > birth.getUTCMonth() ||
    (reference.getUTCMonth() === birth.getUTCMonth() &&
      reference.getUTCDate() >= birth.getUTCDate());
  if (!birthdayPassed) {
    age -= 1;
  }
  return age >= 0 ? age : null;
};

const resolveTravelerAge = (
  birthDate: string | null | undefined,
  fallbackAge: number | null | undefined,
  referenceDate: string | null | undefined
) => {
  const calculated = calculateAgeFromBirthDate(birthDate ?? null, referenceDate ?? null);
  if (typeof calculated === "number" && Number.isFinite(calculated)) return calculated;
  return typeof fallbackAge === "number" && Number.isFinite(fallbackAge) ? fallbackAge : null;
};

const isBirthDateWithinAgeLimit = (
  birthDate?: string | null,
  referenceDate?: string | null,
  maxAgeYears = MAX_INSURANCE_AGE_YEARS
) => {
  const age = calculateAgeFromBirthDate(birthDate ?? null, referenceDate ?? null);
  return typeof age === "number" && age >= 0 && age <= maxAgeYears;
};

const shouldUseInsuranceSocialCard = (
  citizenship: string | null | undefined,
  residency: boolean | null | undefined
) => {
  const normalized = normalizeOptional(citizenship)?.toUpperCase();
  return (normalized === "AM" || normalized === "ARM" || normalized === "ARMENIA") && residency === true;
};

const buildInsuranceTravelerSeeds = (
  rooms: BookingAddonHotelContext["rooms"]
): InsuranceTravelerForm[] => {
  if (!Array.isArray(rooms) || rooms.length === 0) return [];
  return rooms.flatMap((room, roomIndex) => {
    const roomIdentifier =
      typeof room.roomIdentifier === "number" ? room.roomIdentifier : roomIndex + 1;
    const adults = typeof room.adults === "number" && room.adults > 0 ? room.adults : 1;
    const adultTravelers = Array.from({ length: adults }, (_, index) => ({
      id: `room-${roomIdentifier}-adult-${index + 1}`,
      age: DEFAULT_INSURANCE_ADULT_AGE,
      type: "Adult" as const,
      firstName: "",
      lastName: "",
    }));
    const childTravelers = (Array.isArray(room.childrenAges) ? room.childrenAges : []).map(
      (age, index) => ({
        id: `room-${roomIdentifier}-child-${index + 1}`,
        age: Number.isFinite(age) ? age : DEFAULT_INSURANCE_CHILD_AGE,
        type: "Child" as const,
        firstName: "",
        lastName: "",
      })
    );
    return [...adultTravelers, ...childTravelers];
  });
};

export default function BookingAddonsClient({
  bookingId,
  voucherHref,
  hotelContext,
  existingServices,
  serviceFlags,
  paymentMethodFlags,
  lastAddonPayment,
}: BookingAddonsClientProps) {
  const { locale, t } = useLanguage();
  const intlLocale = intlLocales[locale] ?? "en-GB";
  const { rates } = useAmdRates();

  const [includedServices, setIncludedServices] = useState<AddonServiceKey[]>(existingServices);
  const disabledServiceKeys = useMemo(
    () => addonServiceKeys.filter((serviceKey) => serviceFlags[serviceKey] === false),
    [serviceFlags]
  );
  const [disabledServices, setDisabledServices] = useState<AddonServiceKey[]>(disabledServiceKeys);

  useEffect(() => {
    setIncludedServices(existingServices);
  }, [existingServices]);

  useEffect(() => {
    setDisabledServices(disabledServiceKeys);
  }, [disabledServiceKeys]);

  const existingServiceSet = useMemo(() => new Set(includedServices), [includedServices]);
  const disabledServiceSet = useMemo(() => new Set(disabledServices), [disabledServices]);
  const bookingContextKey = useMemo(() => `booking-addon:${bookingId}`, [bookingId]);
  const enabledPaymentMethods = useMemo(
    () => paymentMethodOrder.filter((method) => paymentMethodFlags[method] !== false),
    [paymentMethodFlags]
  );

  const [builderState, setBuilderState] = useState<PackageBuilderState>({});
  const [paymentMethod, setPaymentMethod] = useState<CheckoutPaymentMethod | null>(
    enabledPaymentMethods[0] ?? null
  );
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [transferFlightDetails, setTransferFlightDetails] = useState<TransferFlightDetailsForm>({
    flightNumber: "",
    arrivalDateTime: "",
    departureFlightNumber: "",
    departureDateTime: "",
  });
  const [transferFieldErrors, setTransferFieldErrors] = useState<TransferFlightFieldErrors>({});

  useEffect(() => {
    const syncState = () => setBuilderState(readPackageBuilderState());
    syncState();
    const unsubscribe = subscribePackageBuilderState(syncState);
    return unsubscribe;
  }, []);

  useEffect(() => {
    const roomCount = hotelContext.rooms.length;
    const guestCount = hotelContext.rooms.reduce(
      (sum, room) => sum + room.adults + room.childrenAges.length,
      0
    );

    updatePackageBuilderState((prev) => {
      const sameBookingContext =
        prev.hotel?.selected === true &&
        prev.hotel.selectionKey === bookingContextKey &&
        prev.hotel.hotelCode === hotelContext.hotelCode &&
        prev.hotel.checkInDate === hotelContext.checkInDate &&
        prev.hotel.checkOutDate === hotelContext.checkOutDate &&
        (prev.hotel.destinationCode ?? null) === hotelContext.destinationCode;

      let nextState: PackageBuilderState = sameBookingContext
        ? {
            ...prev,
            hotel: {
              ...prev.hotel,
              selected: true,
              hotelCode: hotelContext.hotelCode,
              hotelName: hotelContext.hotelName,
              destinationCode: hotelContext.destinationCode,
              destinationName: hotelContext.destinationName,
              checkInDate: hotelContext.checkInDate,
              checkOutDate: hotelContext.checkOutDate,
              countryCode: hotelContext.countryCode,
              nationality: hotelContext.nationality,
              currency: hotelContext.currency,
              rooms: hotelContext.rooms,
              roomCount,
              guestCount,
              selectionKey: bookingContextKey,
            },
          }
        : {
            hotel: {
              selected: true,
              hotelCode: hotelContext.hotelCode,
              hotelName: hotelContext.hotelName,
              destinationCode: hotelContext.destinationCode,
              destinationName: hotelContext.destinationName,
              checkInDate: hotelContext.checkInDate,
              checkOutDate: hotelContext.checkOutDate,
              countryCode: hotelContext.countryCode,
              nationality: hotelContext.nationality,
              currency: hotelContext.currency,
              rooms: hotelContext.rooms,
              roomCount,
              guestCount,
              selectionKey: bookingContextKey,
            },
          };

      if (existingServiceSet.has("transfer") && nextState.transfer) {
        const next = { ...nextState };
        delete next.transfer;
        nextState = next;
      }
      if (existingServiceSet.has("excursion") && nextState.excursion) {
        const next = { ...nextState };
        delete next.excursion;
        nextState = next;
      }
      if (existingServiceSet.has("flight") && nextState.flight) {
        const next = { ...nextState };
        delete next.flight;
        nextState = next;
      }
      if (existingServiceSet.has("insurance") && nextState.insurance) {
        const next = { ...nextState };
        delete next.insurance;
        nextState = next;
      }

      return {
        ...nextState,
        sessionExpiresAt: Date.now() + PACKAGE_BUILDER_SESSION_MS,
        updatedAt: Date.now(),
      };
    });
  }, [bookingContextKey, existingServiceSet, hotelContext]);

  useEffect(() => {
    if (paymentMethod && enabledPaymentMethods.includes(paymentMethod)) return;
    setPaymentMethod(enabledPaymentMethods[0] ?? null);
  }, [enabledPaymentMethods, paymentMethod]);

  const transferSelection =
    builderState.transfer?.selected && !existingServiceSet.has("transfer")
      ? builderState.transfer
      : null;
  const excursionSelection =
    builderState.excursion?.selected && !existingServiceSet.has("excursion")
      ? builderState.excursion
      : null;
  const flightSelection =
    builderState.flight?.selected && !existingServiceSet.has("flight")
      ? builderState.flight
      : null;
  const insuranceSelection =
    builderState.insurance?.selected && !existingServiceSet.has("insurance")
      ? builderState.insurance
      : null;
  const todayDateInput = useMemo(() => getTodayDateInput(), []);
  const [activeInsuranceTravelerId, setActiveInsuranceTravelerId] = useState<string | null>(null);
  const [insuranceTravelers, setInsuranceTravelers] = useState<InsuranceTravelerForm[]>([]);

  const insuranceTravelerSeeds = useMemo(
    () => buildInsuranceTravelerSeeds(hotelContext.rooms),
    [hotelContext.rooms]
  );
  const selectedInsuranceGuestIdSet = useMemo(() => {
    const selectedIds =
      Array.isArray(insuranceSelection?.insuredGuestIds) &&
      insuranceSelection.insuredGuestIds.length > 0
        ? insuranceSelection.insuredGuestIds.filter(
            (value): value is string => typeof value === "string" && value.trim().length > 0
          )
        : insuranceTravelerSeeds.map((traveler) => traveler.id);
    return new Set(selectedIds);
  }, [insuranceSelection?.insuredGuestIds, insuranceTravelerSeeds]);

  useEffect(() => {
    if (!insuranceSelection) {
      setInsuranceTravelers([]);
      setActiveInsuranceTravelerId(null);
      return;
    }

    setInsuranceTravelers((prev) => {
      const previousById = new Map(prev.map((traveler) => [traveler.id, traveler]));
      const storedById = new Map(
        (insuranceSelection.travelers ?? [])
          .filter(
            (traveler): traveler is BookingInsuranceTraveler & { id: string } =>
              typeof traveler?.id === "string" && traveler.id.trim().length > 0
          )
          .map((traveler) => [traveler.id, traveler])
      );
      const birthDateReference = insuranceSelection.startDate ?? hotelContext.checkInDate ?? null;
      return insuranceTravelerSeeds
        .filter((traveler) => selectedInsuranceGuestIdSet.has(traveler.id))
        .map((traveler) => {
          const existing = previousById.get(traveler.id) ?? storedById.get(traveler.id) ?? null;
          return {
            ...traveler,
            firstName: normalizeOptional(existing?.firstName) ?? "",
            lastName: normalizeOptional(existing?.lastName) ?? "",
            firstNameEn: normalizeOptional(existing?.firstNameEn) ?? "",
            lastNameEn: normalizeOptional(existing?.lastNameEn) ?? "",
            gender: existing?.gender ?? null,
            birthDate: normalizeOptional(existing?.birthDate),
            residency:
              typeof existing?.residency === "boolean" ? existing.residency : null,
            socialCard: normalizeOptional(existing?.socialCard),
            passportNumber: normalizeOptional(existing?.passportNumber),
            passportAuthority: normalizeOptional(existing?.passportAuthority),
            passportIssueDate: normalizeOptional(existing?.passportIssueDate),
            passportExpiryDate: normalizeOptional(existing?.passportExpiryDate),
            mobilePhone: normalizeOptional(existing?.mobilePhone),
            email: normalizeOptional(existing?.email),
            address: {
              full: normalizeOptional(existing?.address?.full),
              fullEn: normalizeOptional(existing?.address?.fullEn),
              country: normalizeOptional(existing?.address?.country),
              countryId: normalizeOptional(existing?.address?.countryId),
              region: normalizeOptional(existing?.address?.region),
              city: normalizeOptional(existing?.address?.city),
            },
            citizenship:
              normalizeOptional(existing?.citizenship) ??
              normalizeOptional(hotelContext.nationality),
            premium:
              typeof existing?.premium === "number" && Number.isFinite(existing.premium)
                ? existing.premium
                : null,
            premiumCurrency: normalizeOptional(existing?.premiumCurrency),
            policyPremium:
              typeof existing?.policyPremium === "number" && Number.isFinite(existing.policyPremium)
                ? existing.policyPremium
                : null,
            riskAmount:
              typeof existing?.riskAmount === "number" && Number.isFinite(existing.riskAmount)
                ? existing.riskAmount
                : null,
            riskCurrency: normalizeOptional(existing?.riskCurrency),
            riskLabel: normalizeOptional(existing?.riskLabel),
            subrisks: Array.isArray(existing?.subrisks) ? existing.subrisks : null,
            age:
              resolveTravelerAge(existing?.birthDate, traveler.age, birthDateReference) ??
              traveler.age,
          };
        });
    });
  }, [
    hotelContext.checkInDate,
    hotelContext.nationality,
    insuranceSelection,
    insuranceTravelerSeeds,
    selectedInsuranceGuestIdSet,
  ]);

  useEffect(() => {
    if (insuranceTravelers.length === 0) {
      setActiveInsuranceTravelerId(null);
      return;
    }
    if (!insuranceTravelers.some((traveler) => traveler.id === activeInsuranceTravelerId)) {
      setActiveInsuranceTravelerId(insuranceTravelers[0].id);
    }
  }, [activeInsuranceTravelerId, insuranceTravelers]);

  const formatAmount = useCallback(
    (amount: number | null | undefined, currency: string | null | undefined) => {
      const normalized = normalizeAmount(amount ?? null, currency ?? null, rates);
      if (!normalized) return null;
      return formatCurrencyAmount(normalized.amount, normalized.currency, intlLocale);
    },
    [intlLocale, rates]
  );

  const resolveServiceLabel = useCallback(
    (service: AddonServiceKey) => {
      if (service === "transfer") return t.packageBuilder.services.transfer;
      if (service === "excursion") return t.packageBuilder.services.excursion;
      if (service === "insurance") return t.packageBuilder.services.insurance;
      return t.packageBuilder.services.flight;
    },
    [t]
  );

  const resolveServiceLabels = useCallback(
    (services: AddonServiceKey[]) => services.map((service) => resolveServiceLabel(service)).join(", "),
    [resolveServiceLabel]
  );

  const resolveTransferFlightFieldErrors = useCallback((): TransferFlightFieldErrors => {
    if (!transferSelection) return {};
    const errors: TransferFlightFieldErrors = {};
    if (!transferFlightDetails.flightNumber.trim()) {
      errors.flightNumber = t.hotel.addons.transfers.flightNumberRequired;
    }
    if (!transferFlightDetails.arrivalDateTime.trim()) {
      errors.arrivalDateTime = t.hotel.addons.transfers.arrivalRequired;
    }
    if (transferSelection.includeReturn) {
      if (!transferFlightDetails.departureFlightNumber.trim()) {
        errors.departureFlightNumber = t.hotel.addons.transfers.departureFlightNumberRequired;
      }
      if (!transferFlightDetails.departureDateTime.trim()) {
        errors.departureDateTime = t.hotel.addons.transfers.departureRequired;
      }
    }
    return errors;
  }, [t, transferSelection, transferFlightDetails]);

  const updateTransferFlightField = useCallback(
    (field: keyof TransferFlightDetailsForm, value: string) => {
      setTransferFlightDetails((prev) => ({ ...prev, [field]: value }));
      setTransferFieldErrors((prev) => {
        if (!prev[field]) return prev;
        return {
          ...prev,
          [field]: undefined,
        };
      });
    },
    []
  );

  const updateInsuranceTraveler = useCallback(
    (travelerId: string, updates: Partial<InsuranceTravelerForm>) => {
      setInsuranceTravelers((prev) =>
        prev.map((traveler) => {
          if (traveler.id !== travelerId) return traveler;
          const next = {
            ...traveler,
            ...updates,
          };
          if (!shouldUseInsuranceSocialCard(next.citizenship, next.residency)) {
            next.socialCard = null;
          }
          return next;
        })
      );
    },
    []
  );

  const insuranceTravelerIndexMap = useMemo(
    () => new Map(insuranceTravelers.map((traveler, index) => [traveler.id, index])),
    [insuranceTravelers]
  );
  const hasMultipleInsuranceTravelers = insuranceTravelers.length > 1;
  const visibleInsuranceTravelers = hasMultipleInsuranceTravelers
    ? insuranceTravelers.filter((traveler) => traveler.id === activeInsuranceTravelerId)
    : insuranceTravelers;

  const localInsuranceTravelerFieldErrors = useMemo<Record<string, InsuranceTravelerFieldErrors>>(() => {
    if (!insuranceSelection) return {};
    const next: Record<string, InsuranceTravelerFieldErrors> = {};
    const today = parseDateInput(todayDateInput);
    const invalidDateMessage = t.packageBuilder.checkout.errors.invalidDateFormat;
    const birthDateFutureMessage = t.packageBuilder.checkout.errors.birthDateFuture;
    const issueDateFutureMessage = t.packageBuilder.checkout.errors.passportIssueDateFuture;
    const expiryDateOrderMessage =
      t.packageBuilder.checkout.errors.passportExpiryBeforeIssueDate;
    insuranceTravelers.forEach((traveler) => {
      const errors: InsuranceTravelerFieldErrors = {};
      const birthDate = normalizeOptional(traveler.birthDate);
      const birthDateParsed = birthDate ? parseDateInput(birthDate) : null;
      if (birthDate && !birthDateParsed) {
        errors.birthDate = invalidDateMessage;
      } else if (birthDateParsed && today && birthDateParsed.getTime() > today.getTime()) {
        errors.birthDate = birthDateFutureMessage;
      }
      const issueDate = normalizeOptional(traveler.passportIssueDate);
      const issueDateParsed = issueDate ? parseDateInput(issueDate) : null;
      if (issueDate && !issueDateParsed) {
        errors.passportIssueDate = invalidDateMessage;
      } else if (issueDateParsed && today && issueDateParsed.getTime() > today.getTime()) {
        errors.passportIssueDate = issueDateFutureMessage;
      }
      const expiryDate = normalizeOptional(traveler.passportExpiryDate);
      const expiryDateParsed = expiryDate ? parseDateInput(expiryDate) : null;
      if (expiryDate && !expiryDateParsed) {
        errors.passportExpiryDate = invalidDateMessage;
      } else if (
        expiryDateParsed &&
        issueDateParsed &&
        expiryDateParsed.getTime() < issueDateParsed.getTime()
      ) {
        errors.passportExpiryDate = expiryDateOrderMessage;
      }
      if (Object.keys(errors).length > 0) {
        next[traveler.id] = errors;
      }
    });
    return next;
  }, [
    insuranceSelection,
    insuranceTravelers,
    t.packageBuilder.checkout.errors.birthDateFuture,
    t.packageBuilder.checkout.errors.invalidDateFormat,
    t.packageBuilder.checkout.errors.passportExpiryBeforeIssueDate,
    t.packageBuilder.checkout.errors.passportIssueDateFuture,
    todayDateInput,
  ]);

  const resolveInsuranceTravelerPremium = useCallback(
    (travelerId: string) => {
      const quoted = insuranceSelection?.quotePremiumsByGuest?.[travelerId];
      if (typeof quoted === "number" && Number.isFinite(quoted) && quoted > 0) {
        return quoted;
      }
      if (insuranceTravelers.length === 1) {
        const fallback = insuranceSelection?.price ?? null;
        if (typeof fallback === "number" && Number.isFinite(fallback) && fallback > 0) {
          return fallback;
        }
      }
      return null;
    },
    [insuranceSelection?.price, insuranceSelection?.quotePremiumsByGuest, insuranceTravelers.length]
  );

  const resolveInsuranceTravelerSubrisks = useCallback(
    (travelerId: string) => {
      const specific = insuranceSelection?.subrisksByGuest?.[travelerId];
      if (Array.isArray(specific) && specific.length > 0) {
        return specific.filter(
          (value): value is string => typeof value === "string" && value.trim().length > 0
        );
      }
      if (Array.isArray(insuranceSelection?.subrisks) && insuranceSelection.subrisks.length > 0) {
        return insuranceSelection.subrisks.filter(
          (value): value is string => typeof value === "string" && value.trim().length > 0
        );
      }
      return null;
    },
    [insuranceSelection?.subrisks, insuranceSelection?.subrisksByGuest]
  );

  const transferDetailsValid =
    !transferSelection || Object.keys(resolveTransferFlightFieldErrors()).length === 0;

  const insuranceDetailsValid = useMemo(() => {
    if (!insuranceSelection) return true;
    if (insuranceSelection.quoteLoading === true) return false;
    if (insuranceSelection.quoteError) return false;
    if (Object.keys(localInsuranceTravelerFieldErrors).length > 0) return false;

    const planId = insuranceSelection.planId ?? insuranceSelection.selectionId ?? null;
    const hasGlobalRiskAmount =
      typeof insuranceSelection.riskAmount === "number" &&
      Number.isFinite(insuranceSelection.riskAmount) &&
      insuranceSelection.riskAmount > 0;
    const hasRiskByGuest = Object.values(insuranceSelection.riskByGuest ?? {}).some(
      (value) => typeof value === "number" && Number.isFinite(value) && value > 0
    );
    if (
      !planId ||
      (!hasGlobalRiskAmount && !hasRiskByGuest) ||
      !normalizeOptional(insuranceSelection.riskCurrency) ||
      !normalizeOptional(insuranceSelection.territoryCode) ||
      !normalizeOptional(insuranceSelection.travelCountries)
    ) {
      return false;
    }
    if (insuranceTravelers.length === 0) return false;

    const birthDateReference = insuranceSelection.startDate ?? hotelContext.checkInDate ?? null;
    return insuranceTravelers.every((traveler) => {
      const address = traveler.address ?? {};
      const maxAgeYears =
        traveler.type === "Child" ? MAX_INSURANCE_CHILD_AGE_YEARS : MAX_INSURANCE_AGE_YEARS;
      const firstNameEn = normalizeOptional(traveler.firstNameEn);
      const lastNameEn = normalizeOptional(traveler.lastNameEn);
      return (
        Boolean(firstNameEn) &&
        Boolean(lastNameEn) &&
        Boolean(traveler.gender) &&
        Boolean(normalizeOptional(traveler.birthDate)) &&
        isBirthDateWithinAgeLimit(traveler.birthDate, birthDateReference, maxAgeYears) &&
        Boolean(normalizeOptional(traveler.passportNumber)) &&
        Boolean(normalizeOptional(traveler.passportAuthority)) &&
        Boolean(normalizeOptional(traveler.passportIssueDate)) &&
        Boolean(normalizeOptional(traveler.passportExpiryDate)) &&
        (traveler.type !== "Adult" ||
          !shouldUseInsuranceSocialCard(traveler.citizenship, traveler.residency) ||
          Boolean(normalizeOptional(traveler.socialCard))) &&
        Boolean(normalizeOptional(traveler.citizenship)) &&
        traveler.residency !== null &&
        traveler.residency !== undefined &&
        Boolean(normalizeOptional(traveler.mobilePhone)) &&
        Boolean(normalizeOptional(traveler.email)) &&
        Boolean(normalizeOptional(address.full)) &&
        Boolean(normalizeOptional(address.country)) &&
        Boolean(normalizeOptional(address.region)) &&
        Boolean(normalizeOptional(address.city)) &&
        resolveInsuranceTravelerPremium(traveler.id) !== null
      );
    });
  }, [
    hotelContext.checkInDate,
    insuranceSelection,
    insuranceTravelers,
    localInsuranceTravelerFieldErrors,
    resolveInsuranceTravelerPremium,
  ]);

  const blockedServiceMessages = useMemo(() => {
    const messages: string[] = [];
    if (transferSelection && !transferDetailsValid) {
      messages.push(t.hotel.addons.transfers.detailsRequired);
    }
    if (insuranceSelection && !insuranceDetailsValid) {
      messages.push(t.packageBuilder.checkout.errors.insuranceDetailsRequired);
    }
    return messages;
  }, [
    insuranceDetailsValid,
    insuranceSelection,
    t.hotel.addons.transfers.detailsRequired,
    t.packageBuilder.checkout.errors.insuranceDetailsRequired,
    transferDetailsValid,
    transferSelection,
  ]);

  const selectedServiceCards = useMemo<SelectedServiceCard[]>(() => {
    const cards: SelectedServiceCard[] = [
      {
        id: "transfer",
        label: t.packageBuilder.services.transfer,
        price: formatAmount(transferSelection?.price ?? null, transferSelection?.currency ?? null),
        active: Boolean(transferSelection),
        icon: serviceIconMap.transfer,
        ready: transferDetailsValid,
        statusLabel: t.packageBuilder.selectedTag,
        statusTone: transferDetailsValid ? "selected" : "warning",
      },
      {
        id: "excursion",
        label: t.packageBuilder.services.excursion,
        price: formatAmount(excursionSelection?.price ?? null, excursionSelection?.currency ?? null),
        active: Boolean(excursionSelection),
        icon: serviceIconMap.excursion,
        ready: true,
        statusLabel: t.packageBuilder.selectedTag,
        statusTone: "selected",
      },
      {
        id: "insurance",
        label: t.packageBuilder.services.insurance,
        price: formatAmount(insuranceSelection?.price ?? null, insuranceSelection?.currency ?? null),
        active: Boolean(insuranceSelection),
        icon: serviceIconMap.insurance,
        ready: insuranceDetailsValid,
        statusLabel: t.packageBuilder.selectedTag,
        statusTone: insuranceDetailsValid ? "selected" : "warning",
      },
      {
        id: "flight",
        label: t.packageBuilder.services.flight,
        price: formatAmount(flightSelection?.price ?? null, flightSelection?.currency ?? null),
        active: Boolean(flightSelection),
        icon: serviceIconMap.flight,
        ready: true,
        statusLabel: t.packageBuilder.selectedTag,
        statusTone: "selected",
      },
    ];

    return cards.filter((card) => card.active);
  }, [
    excursionSelection,
    flightSelection,
    formatAmount,
    insuranceDetailsValid,
    insuranceSelection,
    t,
    transferDetailsValid,
    transferSelection,
  ]);

  const activeServiceCount = selectedServiceCards.length;
  const allSelectedServicesReady = selectedServiceCards.every((card) => card.ready);

  const selectedTotal = useMemo(() => {
    const selectionSources = [
      { amount: transferSelection?.price, currency: transferSelection?.currency },
      { amount: excursionSelection?.price, currency: excursionSelection?.currency },
      { amount: insuranceSelection?.price, currency: insuranceSelection?.currency },
      { amount: flightSelection?.price, currency: flightSelection?.currency },
    ];

    let totalAmount = 0;
    let totalCurrency: string | null = null;

    selectionSources.forEach((selection) => {
      const normalized = normalizeAmount(selection.amount ?? null, selection.currency ?? null, rates);
      if (!normalized) return;
      if (!totalCurrency) {
        totalCurrency = normalized.currency;
      } else if (totalCurrency !== normalized.currency) {
        totalCurrency = null;
        totalAmount = NaN;
        return;
      }
      totalAmount += normalized.amount;
    });

    if (!totalCurrency || !Number.isFinite(totalAmount) || totalAmount <= 0) return null;
    return formatCurrencyAmount(totalAmount, totalCurrency, intlLocale);
  }, [
    excursionSelection?.currency,
    excursionSelection?.price,
    flightSelection?.currency,
    flightSelection?.price,
    insuranceSelection?.currency,
    insuranceSelection?.price,
    intlLocale,
    rates,
    transferSelection?.currency,
    transferSelection?.price,
  ]);

  const serviceDefinitions = useMemo<ServiceCardDefinition[]>(
    () =>
      addonServiceKeys.map((serviceKey) => ({
        key: serviceKey,
        label: resolveServiceLabel(serviceKey),
        description: t.packageBuilder.pages[serviceKey].body,
        icon: serviceIconMap[serviceKey],
        href: `/${locale}/services/${serviceKey}?flow=booking_addons&bookingId=${encodeURIComponent(
          bookingId
        )}`,
      })),
    [bookingId, locale, resolveServiceLabel, t]
  );

  const actionableServices = useMemo(
    () =>
      serviceDefinitions.filter(
        (service) =>
          !existingServiceSet.has(service.key) && !disabledServiceSet.has(service.key)
      ),
    [disabledServiceSet, existingServiceSet, serviceDefinitions]
  );
  const includedServiceCards = useMemo(
    () => serviceDefinitions.filter((service) => existingServiceSet.has(service.key)),
    [existingServiceSet, serviceDefinitions]
  );
  const unavailableServiceCards = useMemo(
    () =>
      serviceDefinitions.filter(
        (service) =>
          !existingServiceSet.has(service.key) && disabledServiceSet.has(service.key)
      ),
    [disabledServiceSet, existingServiceSet, serviceDefinitions]
  );

  const hasRemainingServices = includedServiceCards.length < addonServiceKeys.length;
  const hasAddableServices = actionableServices.length > 0;
  const stayDates = useMemo(() => {
    const checkInLabel = resolveDateLabel(hotelContext.checkInDate, locale);
    const checkOutLabel = resolveDateLabel(hotelContext.checkOutDate, locale);
    if (checkInLabel && checkOutLabel) return `${checkInLabel} - ${checkOutLabel}`;
    return checkInLabel ?? checkOutLabel ?? null;
  }, [hotelContext.checkInDate, hotelContext.checkOutDate, locale]);
  const lastAddonPaymentDate = useMemo(
    () => resolveDateLabel(lastAddonPayment?.at ?? null, locale),
    [locale, lastAddonPayment?.at]
  );
  const lastAddonPaymentAmount = useMemo(
    () => formatAmount(lastAddonPayment?.amountValue ?? null, lastAddonPayment?.currency ?? null),
    [formatAmount, lastAddonPayment?.amountValue, lastAddonPayment?.currency]
  );

  const roomCount = hotelContext.rooms.length;
  const guestCount = hotelContext.rooms.reduce(
    (sum, room) => sum + room.adults + room.childrenAges.length,
    0
  );

  const lastAddonPaymentProviderLabel = useMemo(() => {
    const provider = lastAddonPayment?.provider?.trim().toLowerCase();
    if (!provider) return null;
    if (provider === "idram") return t.packageBuilder.checkout.methodIdram;
    if (provider === "ameriabank") return t.packageBuilder.checkout.methodCardAmeria;
    if (provider === "idbank") return t.packageBuilder.checkout.methodCard;
    return lastAddonPayment?.provider ?? null;
  }, [lastAddonPayment?.provider, t]);

  const resolveCheckoutError = useCallback(
    (error: unknown) => {
      if (error instanceof ApiError) {
        const services = resolveApiServiceKeys(error);
        if (error.code === "duplicate_payment_attempt") {
          return t.packageBuilder.checkout.errors.duplicatePaymentAttempt;
        }
        if (error.code === "booking_not_confirmed") {
          return t.packageBuilder.checkout.errors.bookingNotConfirmed;
        }
        if (error.code === "booking_canceled") {
          return t.packageBuilder.checkout.errors.bookingCanceled;
        }
        if (error.code === "booking_modification_closed") {
          return t.packageBuilder.checkout.errors.bookingModificationClosed;
        }
        if (error.code === "transfer_details_required") {
          return t.hotel.addons.transfers.detailsRequired;
        }
        if (error.code === "insurance_details_required") {
          return t.packageBuilder.checkout.errors.insuranceDetailsRequired;
        }
        if (error.code === "addon_service_exists") {
          return services.length > 0
            ? `${t.packageBuilder.checkout.errors.addonServiceExists} ${resolveServiceLabels(services)}.`
            : t.packageBuilder.checkout.errors.addonServiceExists;
        }
        if (error.code === "service_disabled") {
          return services.length > 0
            ? `${t.packageBuilder.checkout.errors.serviceDisabled} ${resolveServiceLabels(services)}.`
            : t.packageBuilder.checkout.errors.serviceDisabled;
        }
      }

      return resolveSafeErrorFromUnknown(error, t.packageBuilder.checkout.errors.paymentFailed);
    },
    [resolveServiceLabels, t]
  );

  const buildInsuranceTravelersPayload = useCallback((): BookingInsuranceTraveler[] => {
    if (!insuranceSelection) return [];
    const premiumCurrency =
      normalizeOptional(insuranceSelection.currency) ??
      normalizeOptional(insuranceSelection.riskCurrency);
    return insuranceTravelers.map((traveler) => {
      const firstNameEn = normalizeOptional(traveler.firstNameEn);
      const lastNameEn = normalizeOptional(traveler.lastNameEn);
      const firstName = firstNameEn ?? normalizeOptional(traveler.firstName) ?? "";
      const lastName = lastNameEn ?? normalizeOptional(traveler.lastName) ?? "";
      const citizenship = normalizeOptional(traveler.citizenship);
      const socialCard = shouldUseInsuranceSocialCard(citizenship, traveler.residency)
        ? normalizeOptional(traveler.socialCard)
        : null;
      const premium = resolveInsuranceTravelerPremium(traveler.id);
      const riskAmount =
        typeof insuranceSelection.riskByGuest?.[traveler.id] === "number" &&
        Number.isFinite(insuranceSelection.riskByGuest[traveler.id]) &&
        insuranceSelection.riskByGuest[traveler.id] > 0
          ? insuranceSelection.riskByGuest[traveler.id]
          : typeof insuranceSelection.riskAmount === "number" &&
              Number.isFinite(insuranceSelection.riskAmount) &&
              insuranceSelection.riskAmount > 0
            ? insuranceSelection.riskAmount
            : null;
      const riskCurrency =
        normalizeOptional(insuranceSelection.riskCurrency) ??
        normalizeOptional(traveler.riskCurrency);
      const riskLabel =
        normalizeOptional(traveler.riskLabel) ?? normalizeOptional(insuranceSelection.riskLabel);
      return {
        id: traveler.id,
        firstName,
        lastName,
        firstNameEn,
        lastNameEn,
        gender: traveler.gender ?? null,
        birthDate: normalizeOptional(traveler.birthDate),
        residency: traveler.residency ?? null,
        socialCard,
        passportNumber: normalizeOptional(traveler.passportNumber),
        passportAuthority: normalizeOptional(traveler.passportAuthority),
        passportIssueDate: normalizeOptional(traveler.passportIssueDate),
        passportExpiryDate: normalizeOptional(traveler.passportExpiryDate),
        mobilePhone: normalizeOptional(traveler.mobilePhone),
        email: normalizeOptional(traveler.email),
        address: {
          full: normalizeOptional(traveler.address?.full),
          fullEn: normalizeOptional(traveler.address?.fullEn),
          country: normalizeOptional(traveler.address?.country),
          countryId: normalizeOptional(traveler.address?.countryId),
          region: normalizeOptional(traveler.address?.region),
          city: normalizeOptional(traveler.address?.city),
        },
        citizenship,
        premium,
        premiumCurrency,
        policyPremium: premium,
        riskAmount,
        riskCurrency,
        riskLabel,
        subrisks: resolveInsuranceTravelerSubrisks(traveler.id),
      };
    });
  }, [
    insuranceSelection,
    insuranceTravelers,
    resolveInsuranceTravelerPremium,
    resolveInsuranceTravelerSubrisks,
  ]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (paymentLoading || activeServiceCount === 0) return;
    if (!termsAccepted) return;

    const transferFieldValidation = resolveTransferFlightFieldErrors();
    if (Object.keys(transferFieldValidation).length > 0) {
      setTransferFieldErrors(transferFieldValidation);
      setPaymentError(t.hotel.addons.transfers.detailsRequired);
      return;
    }
    if (insuranceSelection && !insuranceDetailsValid) {
      setPaymentError(t.packageBuilder.checkout.errors.insuranceDetailsRequired);
      return;
    }
    setTransferFieldErrors({});
    setPaymentError(null);

    const addonServices: Record<string, unknown> = {};

    if (transferSelection) {
      const origin =
        transferSelection.origin ??
        (transferSelection.transferOrigin ? { name: transferSelection.transferOrigin } : undefined);
      const destination =
        transferSelection.destination ??
        (transferSelection.transferDestination
          ? { name: transferSelection.transferDestination }
          : undefined);
      const vehicle =
        transferSelection.vehicle ??
        (transferSelection.vehicleName
          ? {
              name: transferSelection.vehicleName,
              maxPax: transferSelection.vehicleMaxPax ?? undefined,
            }
          : undefined);
      const pricingSource = transferSelection.pricing ?? null;
      const pricing = pricingSource
        ? {
            currency: pricingSource.currency ?? transferSelection.currency ?? undefined,
            chargeType: pricingSource.chargeType ?? transferSelection.chargeType ?? undefined,
            oneWay:
              typeof pricingSource.oneWay === "number" ? pricingSource.oneWay : undefined,
            return:
              typeof pricingSource.return === "number" ? pricingSource.return : undefined,
          }
        : {
            currency: transferSelection.currency ?? undefined,
            chargeType: transferSelection.chargeType ?? undefined,
            ...(transferSelection.includeReturn
              ? {
                  return:
                    typeof transferSelection.price === "number"
                      ? transferSelection.price
                      : undefined,
                }
              : {
                  oneWay:
                    typeof transferSelection.price === "number"
                      ? transferSelection.price
                      : undefined,
                }),
          };

      addonServices.transferSelection = {
        id: transferSelection.selectionId ?? "transfer",
        includeReturn: transferSelection.includeReturn ?? undefined,
        flightDetails: {
          flightNumber: transferFlightDetails.flightNumber.trim(),
          arrivalDateTime: transferFlightDetails.arrivalDateTime.trim(),
          ...(transferSelection.includeReturn
            ? {
                departureFlightNumber: transferFlightDetails.departureFlightNumber.trim(),
                departureDateTime: transferFlightDetails.departureDateTime.trim(),
              }
            : {}),
        },
        transferType: normalizeTransferType(transferSelection.transferType ?? null),
        origin,
        destination,
        vehicle,
        paxRange: transferSelection.paxRange ?? undefined,
        pricing,
        validity: transferSelection.validity ?? undefined,
        quantity:
          typeof transferSelection.vehicleQuantity === "number"
            ? transferSelection.vehicleQuantity
            : undefined,
        paxCount:
          typeof transferSelection.paxCount === "number"
            ? transferSelection.paxCount
            : undefined,
        totalPrice: transferSelection.price ?? null,
      };
    }

    if (excursionSelection) {
      const detailedSelections = Array.isArray(excursionSelection.selectionsDetailed)
        ? excursionSelection.selectionsDetailed ?? []
        : [];
      const selectionCurrency = excursionSelection.currency ?? undefined;
      const fallbackSelections = (excursionSelection.items ?? [])
        .filter((item) => item?.id)
        .map((item) => ({
          id: item.id,
          name: item.name ?? undefined,
          currency: selectionCurrency,
          totalPrice: null,
        }));
      const selections =
        detailedSelections.length > 0
          ? detailedSelections
          : fallbackSelections.length > 0
          ? fallbackSelections
          : [
              {
                id: excursionSelection.selectionId ?? "excursion",
                currency: selectionCurrency,
                totalPrice: excursionSelection.price ?? null,
              },
            ];
      addonServices.excursions = {
        totalAmount:
          typeof excursionSelection.price === "number" ? excursionSelection.price : 0,
        selections,
      };
    }

    if (insuranceSelection) {
      const insuranceStartDate = insuranceSelection.startDate ?? hotelContext.checkInDate ?? null;
      const insuranceEndDate = insuranceSelection.endDate ?? hotelContext.checkOutDate ?? null;
      const insuranceTravelersPayload = buildInsuranceTravelersPayload();
      addonServices.insurance = {
        planId: insuranceSelection.planId ?? insuranceSelection.selectionId ?? "insurance",
        planName: insuranceSelection.planLabel ?? insuranceSelection.label ?? null,
        planLabel: insuranceSelection.planLabel ?? insuranceSelection.label ?? null,
        note: null,
        price: insuranceSelection.price ?? null,
        currency: insuranceSelection.currency ?? null,
        provider: "efes",
        riskAmount: insuranceSelection.riskAmount ?? null,
        riskCurrency: insuranceSelection.riskCurrency ?? null,
        riskLabel: insuranceSelection.riskLabel ?? null,
        territoryCode: insuranceSelection.territoryCode ?? null,
        territoryLabel: insuranceSelection.territoryLabel ?? null,
        territoryPolicyLabel: insuranceSelection.territoryPolicyLabel ?? null,
        travelCountries: insuranceSelection.travelCountries ?? null,
        startDate: insuranceStartDate,
        endDate: insuranceEndDate,
        days: insuranceSelection.days ?? null,
        subrisks: insuranceSelection.subrisks ?? null,
        riskByGuest: insuranceSelection.riskByGuest ?? null,
        travelers: insuranceTravelersPayload,
      };
    }

    if (flightSelection) {
      addonServices.airTickets = {
        origin: flightSelection.origin ?? null,
        destination: flightSelection.destination ?? null,
        departureDate: flightSelection.departureDate ?? null,
        returnDate: flightSelection.returnDate ?? null,
        cabinClass: flightSelection.cabinClass ?? null,
        notes: flightSelection.notes ?? null,
        price: flightSelection.price ?? null,
        currency: flightSelection.currency ?? null,
      };
    }

    if (Object.keys(addonServices).length === 0) {
      setPaymentError(t.packageBuilder.checkout.emptySummary);
      return;
    }

    setPaymentLoading(true);
    try {
      if (!paymentMethod) {
        throw new Error(t.packageBuilder.checkout.paymentMethodsUnavailable);
      }

      const requestPayload = {
        flow: "booking_addons",
        bookingId,
        locale,
        addonServices,
      };

      if (paymentMethod === "idram") {
        const checkout = await postJson<IdramCheckoutResponse>(
          "/api/payments/idram/checkout",
          requestPayload
        );
        if (typeof document === "undefined") {
          throw new Error(t.packageBuilder.checkout.errors.paymentFailed);
        }
        const form = document.createElement("form");
        form.method = "POST";
        form.action = checkout.action;
        Object.entries(checkout.fields).forEach(([name, value]) => {
          const input = document.createElement("input");
          input.type = "hidden";
          input.name = name;
          input.value = value;
          form.appendChild(input);
        });
        document.body.appendChild(form);
        form.submit();
        return;
      }

      const paymentProvider = paymentMethod === "ameria_card" ? "ameriabank" : "idbank";
      const checkout = await postJson<VposCheckoutResponse>("/api/payments/vpos/checkout", {
        ...requestPayload,
        paymentProvider,
      });
      if (typeof window === "undefined") {
        throw new Error(t.packageBuilder.checkout.errors.paymentFailed);
      }
      window.location.assign(checkout.formUrl);
    } catch (error) {
      if (error instanceof ApiError) {
        const apiServices = resolveApiServiceKeys(error);
        if (error.code === "addon_service_exists" && apiServices.length > 0) {
          setIncludedServices((prev) => mergeUniqueServiceKeys(prev, apiServices));
        }
        if (error.code === "service_disabled" && apiServices.length > 0) {
          setDisabledServices((prev) => mergeUniqueServiceKeys(prev, apiServices));
        }
      }
      setPaymentError(resolveCheckoutError(error));
      setPaymentLoading(false);
    }
  };

  const renderServicePills = useCallback(
    (services: AddonServiceKey[], tone: "default" | "success" | "warning" = "default") => {
      if (services.length === 0) return null;
      return (
        <div className="booking-addons-pills">
          {services.map((service) => (
            <span key={`${tone}-${service}`} className={`booking-addons-pill is-${tone}`}>
              <span className="material-symbols-rounded">{serviceIconMap[service]}</span>
              {resolveServiceLabel(service)}
            </span>
          ))}
        </div>
      );
    },
    [resolveServiceLabel]
  );

  return (
    <main className="container package-checkout booking-addons-page">
      <section className="profile-card booking-addons-hero">
        <div className="booking-addons-hero__content">
          <p className="package-checkout__eyebrow">
            {t.profile.bookings.labels.bookingId}: {bookingId}
          </p>
          <h1>{t.profile.voucher.addServices.title}</h1>
          <p>{t.profile.voucher.addServices.subtitle}</p>
        </div>

        <div className="booking-addons-actions">
          <Link href={voucherHref} className="payment-link">
            <span className="material-symbols-rounded">description</span>
            {t.profile.bookings.viewVoucher}
          </Link>
        </div>
      </section>

      <section className="profile-card booking-addons-booking">
        <div className="checkout-section__heading">
          <h2>{t.profile.voucher.addServices.bookingSummaryTitle}</h2>
        </div>

        <div className="booking-addons-booking__heading">
          <div>
            <h2>{hotelContext.hotelName ?? t.profile.bookings.labels.hotelName}</h2>
            {hotelContext.destinationName ? (
              <p>{hotelContext.destinationName}</p>
            ) : null}
          </div>
          <span className="booking-addons-booking__code">
            {t.packageBuilder.checkout.labels.hotelCode}: {hotelContext.hotelCode}
          </span>
        </div>

        <div className="booking-addons-booking__meta">
          {stayDates ? (
            <span className="booking-addons-meta-chip">
              <span className="material-symbols-rounded">calendar_month</span>
              {stayDates}
            </span>
          ) : null}
          <span className="booking-addons-meta-chip">
            <span className="material-symbols-rounded">hotel</span>
            {roomCount} {t.profile.bookings.labels.rooms}
          </span>
          <span className="booking-addons-meta-chip">
            <span className="material-symbols-rounded">group</span>
            {guestCount} {t.profile.bookings.labels.guests}
          </span>
        </div>
      </section>

      {lastAddonPayment &&
      (lastAddonPayment.requestedServices.length > 0 ||
        lastAddonPayment.appliedServices.length > 0 ||
        lastAddonPayment.skippedServices.length > 0) ? (
        <section className="profile-card booking-addons-last-payment">
          <div className="booking-addons-last-payment__header">
            <div>
              <h2>{t.profile.voucher.addServices.lastPaymentTitle}</h2>
              <p>
                {[lastAddonPaymentDate, lastAddonPaymentProviderLabel, lastAddonPaymentAmount]
                  .filter((value): value is string => Boolean(value))
                  .join(" / ")}
              </p>
            </div>
          </div>

          <div className="booking-addons-last-payment__grid">
            {lastAddonPayment.requestedServices.length > 0 ? (
              <div className="booking-addons-last-payment__group">
                <span>{t.profile.voucher.addServices.lastPaymentRequested}</span>
                {renderServicePills(lastAddonPayment.requestedServices)}
              </div>
            ) : null}
            {lastAddonPayment.appliedServices.length > 0 ? (
              <div className="booking-addons-last-payment__group">
                <span>{t.profile.voucher.addServices.lastPaymentApplied}</span>
                {renderServicePills(lastAddonPayment.appliedServices, "success")}
              </div>
            ) : null}
            {lastAddonPayment.skippedServices.length > 0 ? (
              <div className="booking-addons-last-payment__group">
                <span>{t.profile.voucher.addServices.lastPaymentSkipped}</span>
                {renderServicePills(lastAddonPayment.skippedServices, "warning")}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="booking-addons-section">
        <div className="checkout-section__heading">
          <h2>{t.profile.voucher.addServices.serviceSelectionTitle}</h2>
          <p className="checkout-section__hint">{t.profile.voucher.addServices.selectionHint}</p>
        </div>

        {hasAddableServices ? (
          <div className="booking-addons-grid">
            {actionableServices.map((service) => {
              const selectedCard =
                selectedServiceCards.find((card) => card.id === service.key) ?? null;
              const isSelected = Boolean(selectedCard);

              return (
                <article
                  key={service.key}
                  className={`profile-card booking-addon-card${isSelected ? " is-selected" : ""}`}
                >
                  <div className="booking-addon-card__icon">
                    <span className="material-symbols-rounded">{service.icon}</span>
                  </div>
                  <div className="booking-addon-card__body">
                    <div className="booking-addon-card__header">
                      <h3>{service.label}</h3>
                      <span
                        className={`booking-addon-status ${
                          isSelected
                            ? selectedCard?.statusTone === "warning"
                              ? "is-warning"
                              : "is-selected"
                            : "is-available"
                        }`}
                      >
                        {isSelected
                          ? selectedCard?.statusLabel ?? t.packageBuilder.selectedTag
                          : t.packageBuilder.addTag}
                      </span>
                    </div>
                    <p>{service.description}</p>
                    {isSelected && selectedCard?.ready === false ? (
                      <p className="checkout-section__hint">
                        {service.key === "transfer"
                          ? t.hotel.addons.transfers.detailsRequired
                          : service.key === "insurance"
                            ? t.packageBuilder.checkout.errors.insuranceDetailsRequired
                            : null}
                      </p>
                    ) : null}
                    <div className="booking-addon-card__footer">
                      <span className="booking-addon-card__price">{selectedCard?.price ?? "—"}</span>
                      <Link href={service.href} className="service-builder__cta">
                        {isSelected
                          ? t.profile.voucher.addServices.updateSelection
                          : t.profile.voucher.addServices.openService}
                      </Link>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <article className="profile-card booking-addons-empty">
            <span className="material-symbols-rounded">inventory_2</span>
            <div>
              <h3>
                {hasRemainingServices
                  ? t.profile.voucher.addServices.noAvailableTitle
                  : t.profile.voucher.addServices.noRemainingTitle}
              </h3>
              <p>
                {hasRemainingServices
                  ? t.profile.voucher.addServices.noAvailableBody
                  : t.profile.voucher.addServices.noRemainingBody}
              </p>
            </div>
          </article>
        )}
      </section>

      {includedServiceCards.length > 0 ? (
        <section className="profile-card booking-addons-state-card">
          <div className="checkout-section__heading">
            <h2>{t.profile.voucher.addServices.includedTitle}</h2>
          </div>
          {renderServicePills(includedServiceCards.map((service) => service.key), "success")}
        </section>
      ) : null}

      {unavailableServiceCards.length > 0 ? (
        <section className="profile-card booking-addons-state-card">
          <div className="checkout-section__heading">
            <h2>{t.profile.voucher.addServices.unavailableTitle}</h2>
          </div>
          {renderServicePills(unavailableServiceCards.map((service) => service.key), "warning")}
        </section>
      ) : null}

      {hasAddableServices ? (
        <form className="profile-card booking-addons-summary" onSubmit={handleSubmit}>
          <div className="booking-addons-summary__header">
            <h2>{t.packageBuilder.checkout.summaryTitle}</h2>
            {selectedTotal ? (
              <div className="booking-addons-total">
                <span>{t.profile.voucher.addServices.totalDue}</span>
                <strong>{selectedTotal}</strong>
              </div>
            ) : null}
          </div>

          {activeServiceCount > 0 ? (
            <div className="checkout-service-list">
              {selectedServiceCards.map((card) => (
                <fieldset key={card.id} className="checkout-service">
                  <legend className="checkout-service__title">
                    <span className="material-symbols-rounded">{card.icon}</span>
                    {card.label}
                  </legend>
                  <ul className="checkout-service__details">
                    <li>{t.packageBuilder.selectedTag}</li>
                    {!card.ready ? (
                      <li>
                        {card.id === "transfer"
                          ? t.hotel.addons.transfers.detailsRequired
                          : card.id === "insurance"
                            ? t.packageBuilder.checkout.errors.insuranceDetailsRequired
                            : t.packageBuilder.checkout.pendingDetails}
                      </li>
                    ) : null}
                  </ul>
                  <span>{card.price ?? t.packageBuilder.checkout.pendingDetails}</span>
                </fieldset>
              ))}
            </div>
          ) : (
            <div className="booking-addons-summary__empty">
              <span className="material-symbols-rounded">add_shopping_cart</span>
              <p>{t.profile.voucher.addServices.emptySelection}</p>
            </div>
          )}

          {transferSelection ? (
            <div className="checkout-section">
              <div className="checkout-section__heading">
                <h2>{t.packageBuilder.services.transfer}</h2>
                <p className="checkout-section__hint">{t.hotel.addons.transfers.detailsRequired}</p>
              </div>
              <div className="checkout-field-grid">
                <label className="checkout-field">
                  <span>{t.hotel.addons.transfers.flightNumber}</span>
                  <input
                    className={`checkout-input${transferFieldErrors.flightNumber ? " error" : ""}`}
                    value={transferFlightDetails.flightNumber}
                    onChange={(event) => updateTransferFlightField("flightNumber", event.target.value)}
                    placeholder="FZ123"
                    required
                  />
                  {transferFieldErrors.flightNumber ? (
                    <span className="field-error" role="alert">
                      {transferFieldErrors.flightNumber}
                    </span>
                  ) : null}
                </label>
                <label className="checkout-field">
                  <span>{t.hotel.addons.transfers.arrivalDate}</span>
                  <input
                    type="datetime-local"
                    className={`checkout-input${transferFieldErrors.arrivalDateTime ? " error" : ""}`}
                    value={transferFlightDetails.arrivalDateTime}
                    onChange={(event) => updateTransferFlightField("arrivalDateTime", event.target.value)}
                    required
                  />
                  {transferFieldErrors.arrivalDateTime ? (
                    <span className="field-error" role="alert">
                      {transferFieldErrors.arrivalDateTime}
                    </span>
                  ) : null}
                </label>
                {transferSelection.includeReturn ? (
                  <>
                    <label className="checkout-field">
                      <span>{t.hotel.addons.transfers.departureFlightNumber}</span>
                      <input
                        className={`checkout-input${
                          transferFieldErrors.departureFlightNumber ? " error" : ""
                        }`}
                        value={transferFlightDetails.departureFlightNumber}
                        onChange={(event) =>
                          updateTransferFlightField("departureFlightNumber", event.target.value)
                        }
                        placeholder="FZ456"
                        required
                      />
                      {transferFieldErrors.departureFlightNumber ? (
                        <span className="field-error" role="alert">
                          {transferFieldErrors.departureFlightNumber}
                        </span>
                      ) : null}
                    </label>
                    <label className="checkout-field">
                      <span>{t.hotel.addons.transfers.departureDate}</span>
                      <input
                        type="datetime-local"
                        className={`checkout-input${
                          transferFieldErrors.departureDateTime ? " error" : ""
                        }`}
                        value={transferFlightDetails.departureDateTime}
                        onChange={(event) =>
                          updateTransferFlightField("departureDateTime", event.target.value)
                        }
                        required
                      />
                      {transferFieldErrors.departureDateTime ? (
                        <span className="field-error" role="alert">
                          {transferFieldErrors.departureDateTime}
                        </span>
                      ) : null}
                    </label>
                  </>
                ) : null}
              </div>
            </div>
          ) : null}

          {insuranceSelection ? (
            <div className="checkout-section">
              <div className="checkout-section__heading">
                <h2>{t.packageBuilder.checkout.insuranceTitle}</h2>
                <p className="checkout-section__hint">{t.packageBuilder.checkout.insuranceHint}</p>
              </div>
              {insuranceTravelers.length === 0 ? (
                <p className="checkout-empty">{t.packageBuilder.checkout.insuranceEmpty}</p>
              ) : (
                <div className="checkout-guests">
                  {hasMultipleInsuranceTravelers ? (
                    <div
                      className="insurance-traveler-tabs"
                      role="tablist"
                      aria-label={t.packageBuilder.checkout.insuranceTitle}
                    >
                      {insuranceTravelers.map((traveler, travelerIndex) => {
                        const tabLabel = t.packageBuilder.checkout.insuranceTravelerLabel.replace(
                          "{index}",
                          (travelerIndex + 1).toString()
                        );
                        const premium = resolveInsuranceTravelerPremium(traveler.id);
                        const premiumLabel = formatAmount(
                          premium,
                          insuranceSelection.currency ?? insuranceSelection.riskCurrency ?? null
                        );
                        const isActive = traveler.id === activeInsuranceTravelerId;
                        return (
                          <button
                            key={traveler.id}
                            type="button"
                            className={`insurance-traveler-tab${isActive ? " is-active" : ""}`}
                            onClick={() => setActiveInsuranceTravelerId(traveler.id)}
                            role="tab"
                            aria-selected={isActive}
                          >
                            <span className="insurance-traveler-tab__label">{tabLabel}</span>
                            <span className="insurance-traveler-tab__meta">
                              {traveler.type === "Adult"
                                ? t.packageBuilder.checkout.guestAdultLabel
                                : t.packageBuilder.checkout.guestChildLabel}
                            </span>
                            {premiumLabel ? (
                              <span className="insurance-traveler-tab__rate">{premiumLabel}</span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                  {visibleInsuranceTravelers.map((traveler) => {
                    const travelerIndex = insuranceTravelerIndexMap.get(traveler.id) ?? 0;
                    const travelerFieldErrors = localInsuranceTravelerFieldErrors[traveler.id] ?? {};
                    const birthDateReference =
                      insuranceSelection.startDate ?? hotelContext.checkInDate ?? null;
                    const birthDateMax = todayDateInput;
                    const maxAgeYears =
                      traveler.type === "Child"
                        ? MAX_INSURANCE_CHILD_AGE_YEARS
                        : MAX_INSURANCE_AGE_YEARS;
                    const birthDateMin =
                      addYearsToDateInput(birthDateReference ?? todayDateInput, -maxAgeYears) ??
                      "1900-01-01";
                    const shouldShowSocialCard = shouldUseInsuranceSocialCard(
                      traveler.citizenship,
                      traveler.residency
                    );
                    return (
                      <div key={traveler.id} className="checkout-guest-card">
                        <div className="checkout-guest-card__heading">
                          <span>
                            {t.packageBuilder.checkout.insuranceTravelerLabel.replace(
                              "{index}",
                              (travelerIndex + 1).toString()
                            )}
                          </span>
                          <span className="checkout-guest-card__lead">
                            {traveler.type === "Adult"
                              ? t.packageBuilder.checkout.guestAdultLabel
                              : t.packageBuilder.checkout.guestChildLabel}
                          </span>
                        </div>

                        <div className="checkout-field-grid">
                          <label className="checkout-field">
                            <span>
                              {t.packageBuilder.checkout.insuranceFields.firstNameEn}{" "}
                              {t.packageBuilder.checkout.latinHint}
                            </span>
                            <input
                              className="checkout-input"
                              type="text"
                              value={traveler.firstNameEn ?? ""}
                              onChange={(event) =>
                                updateInsuranceTraveler(traveler.id, {
                                  firstNameEn: event.target.value,
                                })
                              }
                              required
                            />
                          </label>
                          <label className="checkout-field">
                            <span>
                              {t.packageBuilder.checkout.insuranceFields.lastNameEn}{" "}
                              {t.packageBuilder.checkout.latinHint}
                            </span>
                            <input
                              className="checkout-input"
                              type="text"
                              value={traveler.lastNameEn ?? ""}
                              onChange={(event) =>
                                updateInsuranceTraveler(traveler.id, {
                                  lastNameEn: event.target.value,
                                })
                              }
                              required
                            />
                          </label>
                          <label className="checkout-field">
                            <span>{t.packageBuilder.checkout.insuranceFields.gender}</span>
                            <select
                              className="checkout-input"
                              value={traveler.gender ?? ""}
                              onChange={(event) =>
                                updateInsuranceTraveler(traveler.id, {
                                  gender:
                                    event.target.value === "M" || event.target.value === "F"
                                      ? event.target.value
                                      : null,
                                })
                              }
                              required
                            >
                              <option value="">
                                {t.packageBuilder.checkout.insuranceFields.genderPlaceholder}
                              </option>
                              <option value="M">
                                {t.packageBuilder.checkout.insuranceFields.genderMale}
                              </option>
                              <option value="F">
                                {t.packageBuilder.checkout.insuranceFields.genderFemale}
                              </option>
                            </select>
                          </label>
                          <label className="checkout-field">
                            <span>{t.packageBuilder.checkout.insuranceFields.birthDate}</span>
                            <input
                              className={`checkout-input${travelerFieldErrors.birthDate ? " error" : ""}`}
                              type="date"
                              value={traveler.birthDate ?? ""}
                              min={birthDateMin}
                              max={birthDateMax}
                              onChange={(event) =>
                                updateInsuranceTraveler(traveler.id, {
                                  birthDate: event.target.value,
                                  age:
                                    resolveTravelerAge(
                                      event.target.value,
                                      traveler.age,
                                      birthDateReference
                                    ) ?? traveler.age,
                                })
                              }
                              required
                            />
                            {travelerFieldErrors.birthDate ? (
                              <span className="field-error" role="alert">
                                {travelerFieldErrors.birthDate}
                              </span>
                            ) : null}
                          </label>
                        </div>

                        <div className="checkout-field-grid">
                          <label className="checkout-field">
                            <span>{t.packageBuilder.checkout.insuranceFields.passportNumber}</span>
                            <input
                              className="checkout-input"
                              type="text"
                              value={traveler.passportNumber ?? ""}
                              onChange={(event) =>
                                updateInsuranceTraveler(traveler.id, {
                                  passportNumber: event.target.value,
                                })
                              }
                              required
                            />
                          </label>
                          <label className="checkout-field">
                            <span>{t.packageBuilder.checkout.insuranceFields.passportAuthority}</span>
                            <input
                              className="checkout-input"
                              type="text"
                              value={traveler.passportAuthority ?? ""}
                              onChange={(event) =>
                                updateInsuranceTraveler(traveler.id, {
                                  passportAuthority: event.target.value,
                                })
                              }
                              required
                            />
                          </label>
                          <label className="checkout-field">
                            <span>{t.packageBuilder.checkout.insuranceFields.passportIssueDate}</span>
                            <input
                              className={`checkout-input${
                                travelerFieldErrors.passportIssueDate ? " error" : ""
                              }`}
                              type="date"
                              value={traveler.passportIssueDate ?? ""}
                              max={todayDateInput}
                              onChange={(event) => {
                                const issueDate = event.target.value;
                                updateInsuranceTraveler(traveler.id, {
                                  passportIssueDate: issueDate,
                                  passportExpiryDate:
                                    traveler.type === "Adult"
                                      ? addYearsToDateInput(issueDate, 10)
                                      : traveler.passportExpiryDate ?? null,
                                });
                              }}
                              required
                            />
                            {travelerFieldErrors.passportIssueDate ? (
                              <span className="field-error" role="alert">
                                {travelerFieldErrors.passportIssueDate}
                              </span>
                            ) : null}
                          </label>
                          <label className="checkout-field">
                            <span>{t.packageBuilder.checkout.insuranceFields.passportExpiryDate}</span>
                            <input
                              className={`checkout-input${
                                travelerFieldErrors.passportExpiryDate ? " error" : ""
                              }`}
                              type="date"
                              value={traveler.passportExpiryDate ?? ""}
                              min={traveler.passportIssueDate ?? undefined}
                              onChange={(event) =>
                                updateInsuranceTraveler(traveler.id, {
                                  passportExpiryDate: event.target.value,
                                })
                              }
                              required
                            />
                            {travelerFieldErrors.passportExpiryDate ? (
                              <span className="field-error" role="alert">
                                {travelerFieldErrors.passportExpiryDate}
                              </span>
                            ) : null}
                          </label>
                          <label className="checkout-field">
                            <span>{t.packageBuilder.checkout.insuranceFields.residency}</span>
                            <select
                              className="checkout-input"
                              value={
                                traveler.residency === true
                                  ? "1"
                                  : traveler.residency === false
                                    ? "0"
                                    : ""
                              }
                              onChange={(event) =>
                                updateInsuranceTraveler(traveler.id, {
                                  residency:
                                    event.target.value === "1"
                                      ? true
                                      : event.target.value === "0"
                                        ? false
                                        : null,
                                })
                              }
                              required
                            >
                              <option value="">{t.packageBuilder.checkout.insuranceFields.genderPlaceholder}</option>
                              <option value="1">{t.common.yes}</option>
                              <option value="0">{t.common.no}</option>
                            </select>
                          </label>
                          <label className="checkout-field">
                            <span>{t.packageBuilder.checkout.insuranceFields.citizenship}</span>
                            <input
                              className="checkout-input"
                              type="text"
                              value={traveler.citizenship ?? ""}
                              onChange={(event) =>
                                updateInsuranceTraveler(traveler.id, {
                                  citizenship: event.target.value,
                                })
                              }
                              required
                            />
                          </label>
                          {shouldShowSocialCard ? (
                            <label className="checkout-field">
                              <span>{t.packageBuilder.checkout.insuranceFields.socialCard}</span>
                              <input
                                className="checkout-input"
                                type="text"
                                value={traveler.socialCard ?? ""}
                                onChange={(event) =>
                                  updateInsuranceTraveler(traveler.id, {
                                    socialCard: event.target.value,
                                  })
                                }
                                required={traveler.type === "Adult"}
                              />
                            </label>
                          ) : null}
                        </div>

                        <div className="checkout-field-grid">
                          <label className="checkout-field">
                            <span>{t.packageBuilder.checkout.insuranceFields.mobilePhone}</span>
                            <input
                              className="checkout-input"
                              type="tel"
                              value={traveler.mobilePhone ?? ""}
                              onChange={(event) =>
                                updateInsuranceTraveler(traveler.id, {
                                  mobilePhone: event.target.value,
                                })
                              }
                              required
                            />
                          </label>
                          <label className="checkout-field">
                            <span>{t.packageBuilder.checkout.insuranceFields.email}</span>
                            <input
                              className="checkout-input"
                              type="email"
                              value={traveler.email ?? ""}
                              onChange={(event) =>
                                updateInsuranceTraveler(traveler.id, {
                                  email: event.target.value,
                                })
                              }
                              required
                            />
                          </label>
                        </div>

                        <div className="checkout-field-grid addresses">
                          <label className="checkout-field">
                            <span>{t.packageBuilder.checkout.insuranceFields.address}</span>
                            <input
                              className="checkout-input"
                              type="text"
                              value={traveler.address?.full ?? ""}
                              onChange={(event) =>
                                updateInsuranceTraveler(traveler.id, {
                                  address: {
                                    ...(traveler.address ?? {}),
                                    full: event.target.value,
                                  },
                                })
                              }
                              required
                            />
                          </label>
                          <label className="checkout-field">
                            <span>{t.packageBuilder.checkout.insuranceFields.country}</span>
                            <input
                              className="checkout-input"
                              type="text"
                              value={traveler.address?.country ?? ""}
                              onChange={(event) =>
                                updateInsuranceTraveler(traveler.id, {
                                  address: {
                                    ...(traveler.address ?? {}),
                                    country: event.target.value,
                                  },
                                })
                              }
                              required
                            />
                          </label>
                          <label className="checkout-field">
                            <span>{t.packageBuilder.checkout.insuranceFields.region}</span>
                            <input
                              className="checkout-input"
                              type="text"
                              value={traveler.address?.region ?? ""}
                              onChange={(event) =>
                                updateInsuranceTraveler(traveler.id, {
                                  address: {
                                    ...(traveler.address ?? {}),
                                    region: event.target.value,
                                  },
                                })
                              }
                              required
                            />
                          </label>
                          <label className="checkout-field">
                            <span>{t.packageBuilder.checkout.insuranceFields.city}</span>
                            <input
                              className="checkout-input"
                              type="text"
                              value={traveler.address?.city ?? ""}
                              onChange={(event) =>
                                updateInsuranceTraveler(traveler.id, {
                                  address: {
                                    ...(traveler.address ?? {}),
                                    city: event.target.value,
                                  },
                                })
                              }
                              required
                            />
                          </label>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}

          {activeServiceCount > 0 ? (
            <>
              <label className="checkout-terms">
                <input
                  type="checkbox"
                  checked={termsAccepted}
                  onChange={(event) => setTermsAccepted(event.target.checked)}
                  disabled={paymentLoading}
                />
                <span>
                  {t.packageBuilder.checkout.termsLabel}{" "}
                  <Link href={`/${locale}/refund-policy`}>{t.footer.refundPolicy}</Link>{" "}
                  {t.packageBuilder.checkout.termsConnector}{" "}
                  <Link href={`/${locale}/privacy-policy`}>{t.footer.securityPolicy}</Link>
                </span>
              </label>

              {paymentError ? <p className="checkout-error">{paymentError}</p> : null}
              {!paymentError && blockedServiceMessages.length > 0 ? (
                <p className="checkout-error">{blockedServiceMessages.join(" ")}</p>
              ) : null}
              {!paymentMethod && enabledPaymentMethods.length === 0 ? (
                <p className="checkout-error">{t.packageBuilder.checkout.paymentMethodsUnavailable}</p>
              ) : null}

              <div className="booking-addons-payment">
                <div className="checkout-section__heading">
                  <h2>{t.packageBuilder.checkout.paymentTitle}</h2>
                  <p className="checkout-section__hint">{t.packageBuilder.checkout.paymentHint}</p>
                </div>
                {enabledPaymentMethods.length > 0 ? (
                  <div className="checkout-payment">
                    {enabledPaymentMethods.map((method) => {
                      const label =
                        method === "idram"
                          ? t.packageBuilder.checkout.methodIdram
                          : method === "ameria_card"
                          ? t.packageBuilder.checkout.methodCardAmeria
                          : t.packageBuilder.checkout.methodCard;
                      return (
                        <label key={method} className="checkout-radio">
                          <input
                            type="radio"
                            name="booking-addon-method"
                            checked={paymentMethod === method}
                            onChange={() => setPaymentMethod(method)}
                          />
                          <span>{label}</span>
                        </label>
                      );
                    })}
                  </div>
                ) : null}

                <button
                  type="submit"
                  className="checkout-pay"
                  disabled={
                    paymentLoading ||
                    !termsAccepted ||
                    activeServiceCount === 0 ||
                    !allSelectedServicesReady ||
                    paymentMethod === null
                  }
                >
                  {paymentLoading
                    ? t.packageBuilder.toggleInProgress
                    : resolveMethodPayLabel(paymentMethod ?? "idbank_card", t)}
                </button>
              </div>
            </>
          ) : paymentError ? (
            <p className="checkout-error">{paymentError}</p>
          ) : null}
        </form>
      ) : null}
    </main>
  );
}
