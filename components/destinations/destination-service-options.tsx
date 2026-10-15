"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useLanguage } from "@/components/language-provider";
import { destinationCopy } from "@/lib/destinations/registry";
import { openPackageBuilder, updatePackageBuilderState, type PackageBuilderState } from "@/lib/package-builder-state";
import type { ExtraServiceOffer, ExtraServicePrebookResult, ExtraServiceSearchResult } from "@/lib/packages/contracts";
import { applyDestinationServiceQuote } from "@/lib/packages/selection";
import { packagePaymentCopy } from "@/lib/packages/payment";
import { useDestinationMoney } from "./use-destination-money";
const copy = {
  en: { airport: "Cyprus airport", origin: "Departure airport", arrival: "Airport arrival time", departure: "Hotel departure time", search: "Find options", select: "Select", required: "This service is booked together with your hotel.", empty: "No available options were found for your hotel dates and guests.", selected: "Selected", conditions: "Conditions", changed: "The price or conditions changed. Review the updated details." },
  hy: { airport: "Կիպրոսի օդանավակայան", origin: "Մեկնման օդանավակայան", arrival: "Ժամանման ժամը օդանավակայանում", departure: "Հյուրանոցից մեկնելու ժամը", search: "Գտնել տարբերակներ", select: "Ընտրել", required: "Այս ծառայությունն ամրագրվում է հյուրանոցի հետ միասին։", empty: "Հյուրանոցի ամսաթվերի և հյուրերի համար տարբերակներ չեն գտնվել։", selected: "Ընտրված է", conditions: "Պայմաններ", changed: "Գինը կամ պայմանները փոխվել են։ Ստուգեք թարմացված տվյալները։" },
  ru: { airport: "Аэропорт Кипра", origin: "Аэропорт вылета", arrival: "Время прибытия в аэропорт", departure: "Время выезда из отеля", search: "Найти варианты", select: "Выбрать", required: "Эта услуга бронируется вместе с отелем.", empty: "На даты отеля и для выбранных гостей нет доступных вариантов.", selected: "Выбрано", conditions: "Условия", changed: "Цена или условия изменились. Проверьте обновлённые данные." },
};
export default function DestinationServiceOptions({ service, state }: { service: "transfer" | "flight" | "attraction"; state: PackageBuilderState }) {
  const { locale, t } = useLanguage(), c = copy[locale];
  const format = useDestinationMoney(locale);
  const [airport, setAirport] = useState("LCA"), [origin, setOrigin] = useState("EVN");
  const [arrivalTime, setArrivalTime] = useState("12:00"), [departureTime, setDepartureTime] = useState("09:00");
  const [offers, setOffers] = useState<ExtraServiceOffer[] | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [changed, setChanged] = useState(false);
  const hotelId = state.destinationQuotes?.hotel.offer.id;
  const selected = service === "attraction" ? state.destinationQuotes?.attraction?.offer : state.destinationQuotes?.services?.[service]?.offer;
  const requestKey = JSON.stringify([hotelId, service, airport, origin, arrivalTime, departureTime]);
  const [searchedKey, setSearchedKey] = useState("");
  useEffect(() => { queueMicrotask(() => { setOffers(null); setError(""); setChanged(false); }); }, [hotelId, service]);
  async function run<T>(operation: string, payload: object): Promise<T> {
    const response = await fetch(`/api/destinations/cyprus/${operation}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hotelOfferId: hotelId, ...payload }) });
    if (!response.ok) throw new Error(destinationCopy.unavailable[locale]);
    return response.json();
  }
  async function search() {
    setBusy(true); setError(""); setOffers(null);
    try { const result = await run<ExtraServiceSearchResult>(service === "attraction" ? "attractions/search" : "services/search", { service, airport, origin, arrivalTime, departureTime }); setOffers(result.offers); setSearchedKey(requestKey); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function select(offer: ExtraServiceOffer) {
    setBusy(true); setError("");
    try {
      const result = await run<ExtraServicePrebookResult>(service === "attraction" ? "attractions/prebook" : "services/prebook", { offerId: offer.id });
      updatePackageBuilderState((prev) => applyDestinationServiceQuote(prev, result));
      setChanged(result.priceChanged || result.termsChanged); openPackageBuilder();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  if (!hotelId) return <div className="panel"><p>{t.packageBuilder.warningSelectHotel}</p><Link className="service-builder__cta" href={`/${locale}/cyprus` as Route}>{t.packageBuilder.services.hotel}</Link></div>;
  return <>
    <div className="panel"><p>{c.required}</p>
      {service === "flight" ? <p>{packagePaymentCopy[locale].notice}</p> : null}
      <form onSubmit={(event) => { event.preventDefault(); void search(); }}>
        {service !== "attraction" ? <div className="controls">
          <label>{c.airport}<select value={airport} onChange={(e) => setAirport(e.target.value)}><option value="LCA">Larnaca (LCA)</option><option value="PFO">Paphos (PFO)</option></select></label>
          {service === "transfer" ? <><label>{c.arrival}<input type="time" required value={arrivalTime} onChange={(e) => setArrivalTime(e.target.value)} /></label><label>{c.departure}<input type="time" required value={departureTime} onChange={(e) => setDepartureTime(e.target.value)} /></label></> : <label>{c.origin}<select value={origin} onChange={(e) => setOrigin(e.target.value)}><option value="EVN">Yerevan (EVN)</option><option value="LWN">Gyumri (LWN)</option></select></label>}
        </div> : null}
        <button className="service-builder__cta" disabled={busy}>{busy ? t.packageBuilder.toggleInProgress : c.search}</button>
      </form>
      {error ? <p className="state" role="alert">{error}</p> : null}
    </div>
    {selected?.service === service ? <div className="panel"><h3>{c.selected}: {selected.title}</h3><strong>{format(selected.price.amount, selected.price.currency)}</strong><OfferDetails offer={selected} label={c.conditions} />{changed ? <p>{c.changed}</p> : null}</div> : null}
    {offers && searchedKey === requestKey ? <div className="panel"><div className="options">
      {offers.length === 0 ? <p className="state">{c.empty}</p> : offers.map((offer) => <article key={offer.id} className="option"><div><h3>{offer.title}</h3><p>{format(offer.price.amount, offer.price.currency)}</p><OfferDetails offer={offer} label={c.conditions} /></div><button className="service-builder__cta" disabled={busy} onClick={() => { void select(offer); }}>{c.select}</button></article>)}
    </div></div> : null}
  </>;
}
function OfferDetails({ offer, label }: { offer: ExtraServiceOffer; label: string }) {
  return <><ul>{offer.journeys.map((journey, i) => <li key={i}>{journey.from} → {journey.to} · {journey.departure.replace("T", " ")} · {journey.description}</li>)}</ul>{offer.conditions.length ? <details><summary>{label}</summary>{offer.conditions.map((condition, i) => <p key={i}>{condition}</p>)}</details> : null}</>;
}
