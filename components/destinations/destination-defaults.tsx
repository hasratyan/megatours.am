"use client";
import { useEffect } from "react";
import { useLanguage } from "@/components/language-provider";
import { readPackageBuilderState, updatePackageBuilderState, type PackageBuilderState } from "@/lib/package-builder-state";
import type { ExtraServiceSearchResult } from "@/lib/packages/contracts";
import type { EfesQuoteResult } from "@/types/efes";

/** Defaults are quoted after a validated hotel; removing one does not silently add it again. */
export default function DestinationDefaults({ state }: { state: PackageBuilderState }) {
  const { locale, t } = useLanguage();
  const hotelId = state.destinationQuotes?.hotel.offer.id;
  useEffect(() => {
    if (!hotelId) return;
    const current = readPackageBuilderState();
    if (!current.hotel?.selected || current.destinationQuotes?.hotel.offer.id !== hotelId) return;
    if (current.destinationDefaults?.hotelOfferId === hotelId && current.destinationDefaults.insurance !== "pending" && current.destinationDefaults.attractions !== "pending") return;
    const controller = new AbortController();
    const hotel = current.hotel;
    const startDate = hotel.checkInDate!, endDate = hotel.checkOutDate!;
    const days = Math.ceil((Date.parse(endDate) - Date.parse(startDate)) / 86400000) + 1;
    const travelers = (hotel.rooms ?? []).flatMap((room, roomIndex) => [
      ...Array.from({ length: room.adults }, (_, index) => ({ id: `room-${room.roomIdentifier ?? roomIndex + 1}-adult-${index + 1}`, age: 30 })),
      ...room.childrenAges.map((age, index) => ({ id: `room-${room.roomIdentifier ?? roomIndex + 1}-child-${index + 1}`, age })),
    ]);
    const patch = (run: (prev: PackageBuilderState) => PackageBuilderState) => {
      if (!controller.signal.aborted) updatePackageBuilderState((prev) => prev.destinationQuotes?.hotel.offer.id === hotelId ? run(prev) : prev);
    };
    const insuranceCopy = t.packageBuilder.insurance;
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      patch((prev) => ({ ...prev, destinationDefaults: { hotelOfferId: hotelId, insurance: "pending", attractions: "pending" }, insurance: prev.insurance ?? { selected: true, provider: "efes", planId: "elite", planLabel: insuranceCopy.plans.elite.title, label: insuranceCopy.plans.elite.title, riskAmount: 15000, riskCurrency: "EUR", riskLabel: "STANDARD", territoryCode: "whole_world_exc_uk_sch_us_ca_au_jp", territoryLabel: insuranceCopy.territories.worldwideExcluding, territoryPolicyLabel: insuranceCopy.territories.worldwideExcludingPolicy, travelCountries: insuranceCopy.defaultTravelCountry, startDate, endDate, days, subrisks: [], insuredGuestIds: travelers.map((guest) => guest.id), quoteLoading: true, price: null } }));
      void fetch("/api/insurance/efes/quote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ startDate, endDate, days, territoryCode: "whole_world_exc_uk_sch_us_ca_au_jp", riskAmount: 15000, riskCurrency: "EUR", riskLabel: "STANDARD", subrisks: [], travelers }), signal: controller.signal }).then(async (response) => {
        if (!response.ok) throw new Error("unavailable");
        const quote = await response.json() as EfesQuoteResult;
        if (!Number.isFinite(quote.totalPremium) || quote.totalPremium <= 0 || !quote.currency) throw new Error("unavailable");
        patch((prev) => ({ ...prev, destinationDefaults: { ...prev.destinationDefaults!, insurance: "ready" }, insurance: prev.insurance?.planId !== "elite" || prev.insurance.startDate !== startDate || prev.insurance.endDate !== endDate || prev.insurance.riskAmount !== 15000 || (prev.insurance.subrisks?.length ?? 0) > 0 || Object.values(prev.insurance.riskByGuest ?? {}).some((risk) => risk !== 15000) ? prev.insurance : { ...prev.insurance, price: quote.totalPremium, currency: quote.currency, quoteSum: quote.sum, quoteDiscountedSum: quote.discountedSum, quoteSumByGuest: quote.sumByTraveler, quoteDiscountedSumByGuest: quote.discountedSumByTraveler, quotePriceCoverages: quote.priceCoverages, quoteDiscountedPriceCoverages: quote.discountedPriceCoverages, quotePriceCoveragesByGuest: quote.priceCoveragesByTraveler, quoteDiscountedPriceCoveragesByGuest: quote.discountedPriceCoveragesByTraveler, quotePremiumsByGuest: Object.fromEntries(quote.premiums.map((entry, index) => [entry.travelerId ?? travelers[index]?.id, entry.premium])), quoteLoading: false, quoteError: null } }));
      }).catch(() => patch((prev) => ({ ...prev, destinationDefaults: { ...prev.destinationDefaults!, insurance: "unavailable" }, insurance: prev.insurance ? { ...prev.insurance, quoteLoading: false, quoteError: t.packageBuilder.checkout.errors.insuranceQuoteFailed, price: null } : undefined })));
      void fetch("/api/destinations/cyprus/attractions/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hotelOfferId: hotelId }), signal: controller.signal }).then(async (response) => {
        if (!response.ok) throw new Error("unavailable");
        const { offers } = await response.json() as ExtraServiceSearchResult;
        const offer = offers[0];
        patch((prev) => ({ ...prev, destinationDefaults: { ...prev.destinationDefaults!, attractions: offer ? "ready" : "empty" }, ...(offer && !prev.excursion ? { excursion: { selected: true, selectionId: offer.id, label: offer.title, price: offer.price.amount, currency: offer.price.currency, items: [{ id: offer.id, name: offer.title }] }, destinationQuotes: { ...prev.destinationQuotes!, attraction: { offer, priceChanged: false, termsChanged: false }, review: undefined } } : {}) }));
      }).catch(() => patch((prev) => ({ ...prev, destinationDefaults: { ...prev.destinationDefaults!, attractions: "unavailable" } })));
    });
    return () => controller.abort();
  }, [hotelId, locale, t]);
  return null;
}
