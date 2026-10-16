"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import type { Route } from "next";
import { useLanguage } from "@/components/language-provider";
import { destinationCopy } from "@/lib/destinations/registry";
import { openPackageBuilder, updatePackageBuilderState, type PackageBuilderState } from "@/lib/package-builder-state";
import type { ExtraServiceOffer, ExtraServicePrebookResult, ExtraServiceSearchResult } from "@/lib/packages/contracts";
import { applyDestinationServiceQuote } from "@/lib/packages/selection";
import { packagePaymentCopy } from "@/lib/packages/payment";
import { filterServiceOffers, isWizzAirOffer, serviceCondition, serviceDate, serviceTime, type ServiceCategory } from "@/lib/packages/service-presentation";
import { destinationServiceCopy } from "./destination-service-copy";
import { useDestinationMoney } from "./use-destination-money";

type Service = ExtraServiceOffer["service"];
type Copy = typeof destinationServiceCopy.en;
type FormatMoney = (amount: number, currency: string) => string;
const intlLocales = { en: "en-GB", hy: "hy-AM", ru: "ru-RU" };

export default function DestinationServiceOptions({ service, state }: { service: Service; state: PackageBuilderState }) {
  const { locale, t } = useLanguage();
  const c = destinationServiceCopy[locale], intlLocale = intlLocales[locale];
  const format = useDestinationMoney(locale);
  const [airport, setAirport] = useState("LCA"), [origin, setOrigin] = useState("EVN");
  const [arrivalTime, setArrivalTime] = useState("12:00"), [departureTime, setDepartureTime] = useState("09:00");
  const [offers, setOffers] = useState<ExtraServiceOffer[] | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [changed, setChanged] = useState(false), [category, setCategory] = useState<ServiceCategory>("all");
  const [query, setQuery] = useState(""), [searchedKey, setSearchedKey] = useState("");
  const requestRef = useRef<AbortController | null>(null);
  const hotelId = state.hotel?.selected ? state.destinationQuotes?.hotel.offer.id : undefined;
  const selected = service === "attraction" ? state.destinationQuotes?.attraction?.offer : state.destinationQuotes?.services?.[service]?.offer;
  const requestKey = JSON.stringify([hotelId, service, airport, origin, arrivalTime, departureTime]);
  const currentOffers = searchedKey === requestKey ? offers : null;
  const visibleOffers = filterServiceOffers(currentOffers ?? [], category, query);
  const guestCount = state.hotel?.guestCount ?? state.hotel?.rooms?.reduce((count, room) => count + room.adults + room.childrenAges.length, 0) ?? 0;
  const partyLabel = c.totalParty.replace("{count}", String(guestCount));
  const dateLabel = [state.hotel?.checkInDate, state.hotel?.checkOutDate].map((date) => serviceDate(date, intlLocale)).filter(Boolean).join(" → ");

  useEffect(() => {
    requestRef.current?.abort();
    queueMicrotask(() => { setOffers(null); setError(""); setChanged(false); setBusy(false); setCategory("all"); setQuery(""); });
    return () => requestRef.current?.abort();
  }, [hotelId, service]);

  async function run<T>(operation: string, payload: object, signal: AbortSignal): Promise<T> {
    const response = await fetch("/api/destinations/cyprus/" + operation, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ hotelOfferId: hotelId, ...payload }), signal,
    });
    if (!response.ok) throw new Error(destinationCopy.unavailable[locale]);
    return response.json();
  }

  function startRequest() {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setBusy(true); setError("");
    return controller;
  }

  async function search() {
    const controller = startRequest();
    setOffers(null); setChanged(false);
    try {
      const result = await run<ExtraServiceSearchResult>(service === "attraction" ? "attractions/search" : "services/search", { service, airport, origin, arrivalTime, departureTime }, controller.signal);
      if (!controller.signal.aborted) {
        setOffers(result.offers.filter((offer) => offer.service === service && offer.hotelOfferId === hotelId));
        setSearchedKey(requestKey);
      }
    } catch {
      if (!controller.signal.aborted) setError(destinationCopy.unavailable[locale]);
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }

  async function select(offer: ExtraServiceOffer) {
    const controller = startRequest();
    try {
      const result = await run<ExtraServicePrebookResult>(service === "attraction" ? "attractions/prebook" : "services/prebook", { offerId: offer.id }, controller.signal);
      if (!controller.signal.aborted) {
        updatePackageBuilderState((prev) => applyDestinationServiceQuote(prev, result));
        setOffers((prev) => prev?.map((item) => item.id === offer.id ? result.offer : item) ?? null);
        setChanged(result.priceChanged || result.termsChanged); openPackageBuilder();
      }
    } catch {
      if (!controller.signal.aborted) setError(destinationCopy.unavailable[locale]);
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }

  function chooseCategory(next: ServiceCategory) {
    setCategory(next);
    if (currentOffers) document.getElementById("destination-service-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function categoryNote(value: ServiceCategory) {
    const matching = filterServiceOffers(currentOffers ?? [], value, "");
    if (currentOffers) return c.options.replace("{count}", String(matching.length));
    return c.available;
  }

  if (!hotelId) return <div className="panel destination-service-empty">
    <span className="material-symbols-rounded" aria-hidden="true">hotel</span>
    <p>{t.packageBuilder.warningSelectHotel}</p>
    <Link className="service-builder__cta" href={("/" + locale + "/cyprus") as Route}>{t.packageBuilder.services.hotel}</Link>
  </div>;

  const cardProps = { busy, guestCount, locale: intlLocale, c, format, onSelect: select, addLabel: t.packageBuilder.addTag, selectedLabel: t.packageBuilder.selectedTag };
  const selectedForHotel = selected?.hotelOfferId === hotelId && selected.service === service ? selected : null;
  const optionsClass = "options " + (service === "attraction" ? "excursions" : service === "transfer" ? "transfers" : "destination-flight-options");
  return <div className={"destination-services destination-services--" + service}>
    <div className="flight-search__badges destination-service-context">
      <span className="badge" title={c.hotel}><span className="material-symbols-rounded" aria-hidden="true">hotel</span>{state.hotel?.hotelName}</span>
      <span className="badge" title={c.hotelDates}><span className="material-symbols-rounded" aria-hidden="true">date_range</span>{dateLabel}</span>
      <span className="badge"><span className="material-symbols-rounded" aria-hidden="true">group</span>{partyLabel}</span>
    </div>

    {service === "transfer" ? <div className="service-types transfer destination-transfer-types">
      {([ ["car", c.cars, "/images/car.webp"], ["bus", c.buses, "/images/bus.webp"] ] as const).map(([value, title, image]) =>
        <button type="button" key={value} className={category === value ? "is-selected" : ""} aria-pressed={category === value} onClick={() => chooseCategory(value)}>
          <span><h2>{title}</h2><span>{categoryNote(value)}</span><span className="note">{c.roundTrip}</span></span>
          <Image src={image} alt="" width={300} height={180} unoptimized />
        </button>)}
    </div> : null}

    {service === "attraction" ? <div className="service-types excursion destination-attraction-types">
      {([ ["all", c.all, "cyprus-experiences"], ["sea", c.sea, "cyprus-boat-trips"], ["sightseeing", c.sightseeing, "cyprus-sightseeing"] ] as const).map(([value, title, image]) =>
        <button type="button" key={value} className={category === value ? "is-selected" : ""} aria-pressed={category === value} onClick={() => chooseCategory(value)}>
          <span><h2>{title}</h2><span className="note">{categoryNote(value)}</span></span>
          <Image src={"/images/destinations/" + image + ".webp"} alt="" width={960} height={640} unoptimized />
        </button>)}
    </div> : null}

    {service === "flight" ? <section className="panel flight-redirect destination-flight-brand" aria-label="Wizz Air">
      <div className="destination-flight-brand__copy">
        <Image className="destination-flight-brand__logo" src="/images/logos/wizz-air-white.png" alt="Wizz Air" width={105} height={48} unoptimized />
        <h2>{c.flightTitle}</h2><p>{c.flightNote}</p>
        <span className="badge"><span className="material-symbols-rounded" aria-hidden="true">sync_alt</span>{c.roundTrip}</span>
      </div>
      <Image className="destination-flight-brand__aircraft" src="/images/wizz-air-aircraft.webp" alt="" width={760} height={414} unoptimized />
    </section> : null}

    <section className="panel destination-service-search">
      <p className="destination-service-note">{service === "transfer" ? c.transferNote : c.required}</p>
      <form onSubmit={(event) => { event.preventDefault(); void search(); }}>
        <div className="controls destination-service-controls">
          {service !== "attraction" ? <label className="transfer-airport-select"><span>{c.airport}</span>
            <select value={airport} onChange={(event) => setAirport(event.target.value)} disabled={busy}>
              <option value="LCA">Larnaca (LCA)</option><option value="PFO">Paphos (PFO)</option>
            </select></label> : null}
          {service === "transfer" ? <>
            <label><span>{c.arrival}</span><input type="time" required value={arrivalTime} onChange={(event) => setArrivalTime(event.target.value)} disabled={busy} /></label>
            <label><span>{c.departure}</span><input type="time" required value={departureTime} onChange={(event) => setDepartureTime(event.target.value)} disabled={busy} /></label>
          </> : service === "flight" ? <label><span>{c.origin}</span>
            <select value={origin} onChange={(event) => setOrigin(event.target.value)} disabled={busy}><option value="EVN">Yerevan (EVN)</option><option value="LWN">Gyumri (LWN)</option></select>
          </label> : <div className="destination-service-search__intro"><span className="material-symbols-rounded" aria-hidden="true">explore</span><div><h2>{c.attractionTitle}</h2><p>{c.attractionNote}</p></div></div>}
          <button type="submit" className="service-builder__cta" disabled={busy}>
            <span className="material-symbols-rounded" aria-hidden="true">{busy ? "progress_activity" : "search"}</span>{busy ? t.packageBuilder.toggleInProgress : c.search}
          </button>
        </div>
      </form>
      {service === "flight" ? <p className="destination-flight-payment"><span className="material-symbols-rounded" aria-hidden="true">credit_card</span>{packagePaymentCopy[locale].notice}</p> : null}
      {error ? <p className="state error" role="alert">{error}</p> : null}
      {changed ? <p className="state" role="status">{c.changed}</p> : null}
    </section>

    {selectedForHotel && !visibleOffers.some((offer) => offer.id === selectedForHotel.id) ? <section className="panel destination-service-selected">
      <h2>{c.selected}</h2><div className={optionsClass}><DestinationOfferCard {...cardProps} offer={selectedForHotel} selected /></div>
    </section> : null}

    {currentOffers ? <section className="panel destination-service-results" id="destination-service-results" aria-busy={busy}>
      <div className="controls destination-service-result-controls">
        <label className="destination-service-query"><span className="material-symbols-rounded" aria-hidden="true">search</span><input type="search" aria-label={c.searchOffers} placeholder={c.searchOffers} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <span className="badge" role="status">{c.options.replace("{count}", String(visibleOffers.length))}</span>
        {category !== "all" || query ? <button type="button" className="destination-service-reset" onClick={() => { setCategory("all"); setQuery(""); }}>{c.reset}</button> : null}
      </div>
      {!visibleOffers.length ? <p className="state">{currentOffers.length ? c.noMatch : c.empty}</p> :
        <div className={optionsClass} role="list">
          {visibleOffers.map((offer) => <DestinationOfferCard key={offer.id} {...cardProps} offer={offer} selected={selectedForHotel?.id === offer.id} />)}
        </div>}
    </section> : busy && !error ? <div className="panel destination-service-loading" role="status"><span className="material-symbols-rounded" aria-hidden="true">progress_activity</span>{t.packageBuilder.toggleInProgress}</div> : null}
  </div>;
}

export function DestinationOfferCard({ offer, selected, busy, guestCount, locale, c, format, onSelect, addLabel, selectedLabel }: {
  offer: ExtraServiceOffer; selected: boolean; busy: boolean; guestCount: number; locale: string;
  c: Copy; format: FormatMoney; onSelect: (offer: ExtraServiceOffer) => Promise<void>; addLabel: string; selectedLabel: string;
}) {
  const partyLabel = c.totalParty.replace("{count}", String(guestCount));
  const wizz = isWizzAirOffer(offer);
  const radioId = "destination-offer-" + offer.id;
  const price = <div className="destination-offer-price"><small>{partyLabel}</small><strong>{format(offer.price.amount, offer.price.currency)}</strong></div>;
  const button = <button type="button" className="service-builder__cta" disabled={busy || selected} onClick={() => { void onSelect(offer); }}>
    <span className="material-symbols-rounded" aria-hidden="true">{selected ? "check" : "add_2"}</span>{selected ? selectedLabel : addLabel}
  </button>;
  if (offer.service === "flight") return <article role="listitem" className={"option destination-flight-option" + (selected ? " is-selected" : "")}>
    <div className="destination-flight-option__heading">
      {wizz ? <span className="destination-carrier"><Image src="/images/logos/wizz-air-white.png" alt="Wizz Air" width={70} height={32} unoptimized /></span> : <span className="material-symbols-rounded" aria-hidden="true">flight</span>}
      <div><h3>{offer.title}</h3><span className="meta">{c.roundTrip}</span></div>
      {selected ? <span className="badge">{selectedLabel}</span> : null}
    </div>
    <div className="destination-flight-journeys">{offer.journeys.map((journey, index) => <FlightJourney key={index} journey={journey} label={index === 0 ? c.outbound : c.inbound} locale={locale} />)}</div>
    <OfferConditions offer={offer} locale={locale} c={c} />
    <div className="destination-offer-footer">{price}{button}</div>
  </article>;

  if (offer.service === "attraction") return <article role="listitem" className={"option selectable destination-attraction-option" + (selected ? " is-selected" : "")}>
    <input id={radioId} type="radio" name="destination-attraction" checked={selected} disabled={busy} onChange={() => { if (!selected) void onSelect(offer); }} aria-label={offer.title} />
    <div className="content"><div className="info"><div><h5><label htmlFor={radioId}>{offer.title}</label></h5>
      {offer.journeys.map((journey, index) => <p key={index}>{journey.description}</p>)}
    </div></div><p className="meta"><span className="material-symbols-rounded" aria-hidden="true">date_range</span>{serviceDate(offer.journeys[0]?.departure, locale)}</p>
      <OfferConditions offer={offer} locale={locale} c={c} />
      <div className="pricing destination-offer-footer">{price}{button}</div>
    </div>
  </article>;

  return <article role="listitem" className={"option destination-transfer-option" + (selected ? " is-selected" : "")}>
    <div className="destination-transfer-option__content">
      <h3 className="route">{offer.journeys[0]?.from}<span className="material-symbols-rounded" aria-hidden="true">sync_alt</span>{offer.journeys[0]?.to}</h3>
      <p className="meta type"><span className="material-symbols-rounded" aria-hidden="true">directions_car</span>{offer.title}</p>
      {offer.journeys.map((journey, index) => <p className="meta" key={index}><span className="material-symbols-rounded" aria-hidden="true">{index === 0 ? "flight_land" : "flight_takeoff"}</span>
        <span>{index === 0 ? c.outbound : c.inbound}: {serviceDate(journey.departure, locale)} {serviceTime(journey.departure)}</span></p>)}
      <OfferConditions offer={offer} locale={locale} c={c} />
    </div><div className="destination-offer-footer">{price}{button}</div>
  </article>;
}

function FlightJourney({ journey, label, locale }: { journey: ExtraServiceOffer["journeys"][number]; label: string; locale: string }) {
  return <div className="destination-flight-journey"><div className="destination-flight-journey__label">{label}<span>{journey.description}</span></div>
    <div className="destination-flight-journey__route"><div><strong>{serviceTime(journey.departure) ?? "—"}</strong><b>{journey.from}</b><small>{serviceDate(journey.departure, locale)}</small></div>
      <span className="material-symbols-rounded" aria-hidden="true">flight</span>
      <div><strong>{serviceTime(journey.arrival) ?? "—"}</strong><b>{journey.to}</b><small>{serviceDate(journey.arrival, locale)}</small></div>
    </div>
  </div>;
}

function OfferConditions({ offer, locale, c }: { offer: ExtraServiceOffer; locale: string; c: Copy }) {
  if (!offer.conditions.length) return null;
  return <details className="destination-offer-conditions"><summary>{c.conditions}</summary><ul>{offer.conditions.map((condition, index) => <li key={index}>{serviceCondition(condition, locale, c.cancellationFrom)}</li>)}</ul></details>;
}
