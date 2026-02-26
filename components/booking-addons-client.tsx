"use client";

import type { FormEvent } from "react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLanguage } from "@/components/language-provider";
import { ApiError, postJson } from "@/lib/api-helpers";
import { resolveSafeErrorFromUnknown } from "@/lib/error-utils";
import { formatCurrencyAmount, normalizeAmount } from "@/lib/currency";
import { useAmdRates } from "@/lib/use-amd-rates";
import {
  PACKAGE_BUILDER_SESSION_MS,
  readPackageBuilderState,
  subscribePackageBuilderState,
  updatePackageBuilderState,
  type PackageBuilderState,
} from "@/lib/package-builder-state";
import type { CheckoutPaymentMethod, PaymentMethodFlags } from "@/lib/payment-method-flags";

type AddonServiceKey = "transfer" | "excursion" | "insurance" | "flight";

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

type BookingAddonsClientProps = {
  bookingId: string;
  voucherHref: string;
  hotelContext: {
    hotelCode: string;
    hotelName: string | null;
    destinationCode: string | null;
    destinationName: string | null;
    checkInDate: string | null;
    checkOutDate: string | null;
    countryCode: string;
    nationality: string;
    currency: string;
    rooms: Array<{
      roomIdentifier: number;
      adults: number;
      childrenAges: number[];
    }>;
  };
  existingServices: AddonServiceKey[];
  serviceFlags: Record<AddonServiceKey, boolean>;
  paymentMethodFlags: PaymentMethodFlags;
};

const intlLocales = {
  hy: "hy-AM",
  en: "en-GB",
  ru: "ru-RU",
} as const;

const paymentMethodOrder: CheckoutPaymentMethod[] = ["idram", "idbank_card", "ameria_card"];

const normalizeTransferType = (value: string | null | undefined): "INDIVIDUAL" | "GROUP" | undefined => {
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

export default function BookingAddonsClient({
  bookingId,
  voucherHref,
  hotelContext,
  existingServices,
  serviceFlags,
  paymentMethodFlags,
}: BookingAddonsClientProps) {
  const { locale, t } = useLanguage();
  const intlLocale = intlLocales[locale] ?? "en-GB";
  const { rates } = useAmdRates();

  const existingServiceSet = useMemo(() => new Set(existingServices), [existingServices]);
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

  const selectedServiceCards = useMemo(() => {
    const cards: Array<{ id: AddonServiceKey; label: string; price: string | null; active: boolean }> = [];

    const resolvePrice = (amount: number | null | undefined, currency: string | null | undefined) => {
      const normalized = normalizeAmount(amount ?? null, currency ?? null, rates);
      if (!normalized) return null;
      return formatCurrencyAmount(normalized.amount, normalized.currency, intlLocale);
    };

    cards.push({
      id: "transfer",
      label: t.packageBuilder.services.transfer,
      price: resolvePrice(transferSelection?.price ?? null, transferSelection?.currency ?? null),
      active: Boolean(transferSelection),
    });
    cards.push({
      id: "excursion",
      label: t.packageBuilder.services.excursion,
      price: resolvePrice(excursionSelection?.price ?? null, excursionSelection?.currency ?? null),
      active: Boolean(excursionSelection),
    });
    cards.push({
      id: "flight",
      label: t.packageBuilder.services.flight,
      price: resolvePrice(flightSelection?.price ?? null, flightSelection?.currency ?? null),
      active: Boolean(flightSelection),
    });
    cards.push({
      id: "insurance",
      label: t.packageBuilder.services.insurance,
      price: resolvePrice(insuranceSelection?.price ?? null, insuranceSelection?.currency ?? null),
      active: Boolean(insuranceSelection),
    });

    return cards;
  }, [
    excursionSelection,
    flightSelection,
    insuranceSelection,
    intlLocale,
    rates,
    t,
    transferSelection,
  ]);

  const activeServiceCount = selectedServiceCards.filter((item) => item.active).length;

  const resolveCheckoutError = useCallback(
    (error: unknown) => {
      if (error instanceof ApiError && error.code === "duplicate_payment_attempt") {
        return t.packageBuilder.checkout.errors.duplicatePaymentAttempt;
      }
      return resolveSafeErrorFromUnknown(error, t.packageBuilder.checkout.errors.paymentFailed);
    },
    [t.packageBuilder.checkout.errors.duplicatePaymentAttempt, t.packageBuilder.checkout.errors.paymentFailed]
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (paymentLoading) return;
    if (!termsAccepted) return;

    const transferFieldValidation = resolveTransferFlightFieldErrors();
    if (Object.keys(transferFieldValidation).length > 0) {
      setTransferFieldErrors(transferFieldValidation);
      setPaymentError(t.hotel.addons.transfers.detailsRequired);
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
        travelers: insuranceSelection.travelers ?? null,
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
      setPaymentError(resolveCheckoutError(error));
      setPaymentLoading(false);
    }
  };

  const services: Array<{ key: AddonServiceKey; label: string }> = [
    { key: "transfer", label: t.packageBuilder.services.transfer },
    { key: "excursion", label: t.packageBuilder.services.excursion },
    { key: "insurance", label: t.packageBuilder.services.insurance },
    { key: "flight", label: t.packageBuilder.services.flight },
  ];

  return (
    <main className="container package-checkout booking-addons-page">
      <div className="package-checkout__header">
        <h1>{t.packageBuilder.title}</h1>
        <p>
          {t.profile.bookings.labels.bookingId}: <strong>{bookingId}</strong>
        </p>
      </div>

      <div className="booking-addons-actions">
        <Link href={voucherHref} className="payment-link">
          <span className="material-symbols-rounded">description</span>
          {t.profile.bookings.viewVoucher}
        </Link>
      </div>

      <section className="booking-addons-grid">
        {services.map((service) => {
          const isEnabled = serviceFlags[service.key] !== false;
          const isIncluded = existingServiceSet.has(service.key);
          const isSelected = selectedServiceCards.find((card) => card.id === service.key)?.active === true;
          const href = `/${locale}/services/${service.key}?flow=booking_addons&bookingId=${encodeURIComponent(bookingId)}`;

          return (
            <article key={service.key} className="profile-card booking-addon-card">
              <h3>{service.label}</h3>
              <p className="booking-addon-status">
                {!isEnabled
                  ? t.packageBuilder.disabledTag
                  : isIncluded
                  ? t.packageBuilder.selectedTag
                  : isSelected
                  ? t.packageBuilder.selectedTag
                  : t.packageBuilder.addTag}
              </p>
              {isEnabled && !isIncluded ? (
                <Link href={href} className="service-builder__cta">
                  {t.packageBuilder.pages[service.key].cta}
                </Link>
              ) : null}
            </article>
          );
        })}
      </section>

      <form className="profile-card booking-addons-summary" onSubmit={handleSubmit}>
        <h2>{t.packageBuilder.checkout.summaryTitle}</h2>
        <div className="checkout-service-list">
          {selectedServiceCards.map((card) => (
            <fieldset key={card.id} className="checkout-service">
              <legend className="checkout-service__title">
                {card.label}
              </legend>
              <ul className="checkout-service__details">
                <li>
                  {card.active ? t.packageBuilder.selectedTag : t.packageBuilder.addTag}
                </li>
              </ul>
              <span>{card.price ?? "—"}</span>
            </fieldset>
          ))}
        </div>

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
                  onChange={(event) =>
                    setTransferFlightDetails((prev) => ({
                      ...prev,
                      flightNumber: event.target.value,
                    }))
                  }
                  placeholder="FZ123"
                />
              </label>
              <label className="checkout-field">
                <span>{t.hotel.addons.transfers.arrivalDate}</span>
                <input
                  type="datetime-local"
                  className={`checkout-input${transferFieldErrors.arrivalDateTime ? " error" : ""}`}
                  value={transferFlightDetails.arrivalDateTime}
                  onChange={(event) =>
                    setTransferFlightDetails((prev) => ({
                      ...prev,
                      arrivalDateTime: event.target.value,
                    }))
                  }
                />
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
                        setTransferFlightDetails((prev) => ({
                          ...prev,
                          departureFlightNumber: event.target.value,
                        }))
                      }
                      placeholder="FZ456"
                    />
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
                        setTransferFlightDetails((prev) => ({
                          ...prev,
                          departureDateTime: event.target.value,
                        }))
                      }
                    />
                  </label>
                </>
              ) : null}
            </div>
          </div>
        ) : null}

        <label className="checkout-terms">
          <input
            type="checkbox"
            checked={termsAccepted}
            onChange={(event) => setTermsAccepted(event.target.checked)}
            disabled={paymentLoading}
          />
          <span>
            {t.packageBuilder.checkout.termsLabel} <Link href={`/${locale}/refund-policy`}>{t.footer.refundPolicy}</Link>
            {" "}{t.packageBuilder.checkout.termsConnector}{" "}
            <Link href={`/${locale}/privacy-policy`}>{t.footer.securityPolicy}</Link>
          </span>
        </label>

        {paymentError ? <p className="checkout-error">{paymentError}</p> : null}

        <div className="booking-addons-payment">
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

          <button
            type="submit"
            className="checkout-pay"
            disabled={
              paymentLoading ||
              !termsAccepted ||
              activeServiceCount === 0 ||
              paymentMethod === null
            }
          >
            {paymentLoading
              ? t.packageBuilder.toggleInProgress
              : resolveMethodPayLabel(paymentMethod ?? "idbank_card", t)}
          </button>
        </div>
      </form>
    </main>
  );
}
