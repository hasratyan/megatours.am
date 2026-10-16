"use client";
import Image from "next/image";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useLanguage } from "@/components/language-provider";
import type { DestinationOrder, ExtraServiceOffer, Money } from "@/lib/packages/contracts";
import { destinationOrderCopy } from "./destination-order-copy";
import { serviceDate, serviceTime, serviceCondition } from "@/lib/packages/service-presentation";

type Status = { order: DestinationOrder; hotelAmount: Money; insuranceStatus: string | null };
type Passenger = { firstName: string; lastName: string; dateOfBirth: string; gender: string; nationality: string; passportNumber: string; passportExpiry: string };
type Card = { cardholderName: string; number: string; security: string; month: string; year: string; type: string; address: { addressLine: string; city: string; postalCode: string; countryCode: string } };
const blankCard = (): Card => ({ cardholderName: "", number: "", security: "", month: "", year: "", type: "", address: { addressLine: "", city: "", postalCode: "", countryCode: "AM" } });
const money = (price: Money, locale: string) => new Intl.NumberFormat(locale === "hy" ? "hy-AM" : locale === "ru" ? "ru-RU" : "en-GB", { style: "currency", currency: price.currency }).format(price.amount);
export default function DestinationOrderClient({ orderId }: { orderId: string }) {
  const { locale } = useLanguage(), c = destinationOrderCopy[locale];
  const [status, setStatus] = useState<Status | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [offers, setOffers] = useState<ExtraServiceOffer[] | null>(null), [origin, setOrigin] = useState("EVN"), [airport, setAirport] = useState("LCA");
  const [passengers, setPassengers] = useState<Passenger[]>([]), [phoneCode, setPhoneCode] = useState("374"), [phone, setPhone] = useState(""), [email, setEmail] = useState("");
  const [card, setCard] = useState<Card>(blankCard), [payer, setPayer] = useState({ firstName: "", lastName: "" });
  const [fee, setFee] = useState<{ id: string; amount: number; surcharge: number; currency: string } | null>(null), [accepted, setAccepted] = useState(false);
  const request = useCallback(async <T,>(operation: string, payload: object = {}): Promise<T> => {
    const response = await fetch(`/api/destinations/cyprus/orders/${operation}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, orderId }), cache: "no-store" });
    if (!response.ok) throw new Error(response.status === 409 ? c.expired : c.error);
    return response.json() as Promise<T>;
  }, [orderId, c.error, c.expired]);
  useEffect(() => {
    let active = true;
    void request<Status>("status").then((next) => { if (!active) return; setStatus(next); setEmail(next.order.contact.email); setPassengers(next.order.guests.map((guest) => ({ firstName: guest.firstName, lastName: guest.lastName, dateOfBirth: "", gender: "", nationality: "AM", passportNumber: "", passportExpiry: "" }))); }).catch((err: Error) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [request]);
  const order = status?.order;
  const ready = order?.hotelPaid === true && order.hotelStatus === "confirmed";
  const flight = order?.flight;
  const waiting = flight && ["paying", "creating", "pending", "unknown", "challenge"].includes(flight.status);
  useEffect(() => {
    if (!waiting && !(order?.hotelPaid && order.hotelStatus !== "confirmed")) return;
    const timer = setInterval(() => { void (ready ? request<DestinationOrder>("flights/refresh") : request<Status>("hotel/refresh").then((next) => next.order)).then((next) => { setStatus((current) => current ? { ...current, order: next } : current); if (next.flightError) setError(c.error); }).catch(() => {}); }, 10_000);
    return () => clearInterval(timer);
  }, [waiting, request, c.error, order?.hotelPaid, order?.hotelStatus, ready]);
  async function run(action: () => Promise<void>) { if (busy) return; setBusy(true); setError(""); try { await action(); } catch (err) { setError(err instanceof Error ? err.message : c.error); } finally { setBusy(false); } }
  const updateOrder = (next: DestinationOrder) => setStatus((current) => current ? { ...current, order: next } : current);
  async function refresh() { await run(async () => { const next = await request<Status>("hotel/refresh"); setStatus(next); if (next.order.hotelPaid && next.order.hotelStatus === "confirmed" && !["not_selected", "quoted"].includes(next.order.flight.status)) updateOrder(await request<DestinationOrder>("flights/refresh")); }); }
  function field(label: string, value: string, onChange: (value: string) => void, type = "text", attrs: Record<string, string | number> = {}) {
    return <label className="destination-order__field"><span>{label}</span><input type={type} value={value} required onChange={(event) => onChange(event.target.value)} disabled={busy} {...attrs} /></label>;
  }
  const offerCard = (offer: ExtraServiceOffer, selectable: boolean) => <article className="destination-order__fare" key={offer.id}>
    <div className="destination-order__fare-heading"><Image src="/images/logos/wizz-air-white.png" alt="Wizz Air" width="120" height="32" /><strong>{money(offer.price, locale)}</strong></div>
    {offer.journeys.map((journey, index) => <p key={index}><strong>{journey.from} → {journey.to}</strong> · {serviceDate(journey.departure, locale)} · {serviceTime(journey.departure)}{journey.arrival ? ` → ${serviceTime(journey.arrival)}` : ""}</p>)}
    <ul>{offer.conditions.map((condition, index) => <li key={index}>{serviceCondition(condition, locale, "")}</li>)}</ul>
    {selectable ? <button type="button" disabled={busy} className="checkout-pay" onClick={() => void run(async () => { updateOrder(await request<DestinationOrder>("flights/select", { offerId: offer.id })); setOffers(null); setFee(null); })}>{c.select}</button> : null}
  </article>;
  async function book(event: FormEvent) { event.preventDefault(); await run(async () => { updateOrder(await request<DestinationOrder>("flights/book", { passengers, contact: { email, phoneCountryCode: phoneCode, phoneNumber: phone } })); setFee(null); }); }
  async function fees(event: FormEvent) { event.preventDefault(); await run(async () => { const result = await request<{ fee: { id: string; amount: number; surcharge: number; currency: string } | null; order?: DestinationOrder }>("flights/fees", { card }); if (result.order) updateOrder(result.order); setFee(result.fee); setAccepted(false); }); }
  async function pay() { await run(async () => { try { updateOrder(await request<DestinationOrder>("flights/pay", { card, feeQuoteId: fee?.id, payer })); } finally { setCard(blankCard()); setFee(null); setAccepted(false); } }); }
  return <main className="package-checkout destination-order"><div className="container"><h1>{c.title}</h1>
    {error ? <p className="destination-order__notice" role="alert">{error}</p> : null}
    {!order ? <p role="status">{busy ? c.processingShort : error || c.processingShort}</p> : <>
      <section className="package-checkout__panel checkout-section"><h2>1. {c.hotel}</h2><h3>{order.hotel.name}</h3><p>{c.days}: {serviceDate(order.hotel.checkIn, locale)} → {serviceDate(order.hotel.checkOut, locale)}</p><p><strong>{money(status.hotelAmount, locale)}</strong></p>
        <p role="status">{ready ? c.confirmed : order.hotelPaid ? c.processing : c.awaiting}</p>{order.hotelReference ? <p>{c.reference}: <strong>{order.hotelReference}</strong></p> : null}
        {order.extras.map((extra) => <p key={extra.service}>{extra.service === "transfer" ? { en: "Transfer", ru: "Трансфер", hy: "Տրանսֆեր" }[locale] : { en: "Excursion", ru: "Экскурсия", hy: "Էքսկուրսիա" }[locale]}: {extra.status === "confirmed" ? c.confirmedExtra : c.unknownExtra}{extra.reference ? ` · ${extra.reference}` : ""}</p>)}
        {status.insuranceStatus ? <p>{c.insurance}: {status.insuranceStatus === "confirmed" ? c.confirmedExtra : c.unknownExtra}</p> : null}
        <button type="button" className="checkout-apply" disabled={busy} onClick={() => void refresh()}>{busy ? c.processingShort : c.refresh}</button>
      </section>
      <section className="package-checkout__panel checkout-section"><h2>2. {c.flight}</h2><p>{ready ? c.separate : c.first}</p>
        {ready && flight ? <>
          {flight.reference ? <p>{c.reference}: <strong>{flight.reference}</strong></p> : null}
          {["paid", "ticketed"].includes(flight.status) ? <p role="status">{flight.status === "ticketed" ? c.ticketed : c.paid}</p> : waiting ? <p className="destination-order__notice" role="status">{c.processing}</p> : null}
          {["not_selected", "quoted"].includes(flight.status) ? <>
            <div className="destination-order__fields"><label className="destination-order__field"><span>{c.departure}</span><select value={origin} onChange={(event) => setOrigin(event.target.value)}><option value="EVN">Yerevan (EVN)</option><option value="LWN">Gyumri (LWN)</option></select></label><label className="destination-order__field"><span>{c.arrival}</span><select value={airport} onChange={(event) => setAirport(event.target.value)}><option value="LCA">Larnaca (LCA)</option><option value="PFO">Paphos (PFO)</option></select></label></div>
            <button className="checkout-pay" type="button" disabled={busy} onClick={() => void run(async () => { const next = await request<{ offers: ExtraServiceOffer[] }>("flights/search", { origin, airport }); setOffers(next.offers); })}>{busy ? c.processingShort : c.search}</button>
            {offers?.length === 0 ? <p>{c.empty}</p> : offers?.map((offer) => offerCard(offer, true))}
          </> : null}
          {flight.offer ? <><h3>{c.selected}</h3>{offerCard(flight.offer, false)}</> : null}
          {flight.status === "quoted" && flight.offer ? <form onSubmit={book}><h3>{c.guests}</h3><p>{c.passportName}</p>{passengers.map((passenger, index) => {
            const change = (key: keyof Passenger, value: string) => setPassengers((current) => current.map((item, i) => i === index ? { ...item, [key]: value } : item));
            return <fieldset key={index}><legend>{passenger.firstName} {passenger.lastName}</legend><div className="destination-order__fields">{field(c.birth, passenger.dateOfBirth, (value) => change("dateOfBirth", value), "date")}
              <label className="destination-order__field"><span>{c.gender}</span><select required value={passenger.gender} onChange={(event) => change("gender", event.target.value)}><option value="">—</option><option value="male">{c.male}</option><option value="female">{c.female}</option></select></label>
              {field(c.nationality, passenger.nationality, (value) => change("nationality", value.toUpperCase()), "text", { maxLength: 2 })}{field(c.passport, passenger.passportNumber, (value) => change("passportNumber", value))}{field(c.expiry, passenger.passportExpiry, (value) => change("passportExpiry", value), "date")}</div></fieldset>;
          })}<div className="destination-order__fields">{field(c.email, email, setEmail, "email")}{field(c.phoneCode, phoneCode, setPhoneCode, "tel")}{field(c.phone, phone, setPhone, "tel")}</div><button disabled={busy} className="checkout-pay">{busy ? c.processingShort : c.continue}</button></form> : null}
          {flight.canPay ? <form onSubmit={fees}><h3>{c.card}</h3>{flight.amount ? <p>{money(flight.amount, locale)}</p> : null}<div className="destination-order__fields">
            {field(c.firstName, payer.firstName, (value) => setPayer((current) => ({ ...current, firstName: value })))}{field(c.lastName, payer.lastName, (value) => setPayer((current) => ({ ...current, lastName: value })))}
            {field(c.cardName, card.cardholderName, (value) => { setCard((current) => ({ ...current, cardholderName: value })); setFee(null); }, "text", { autoComplete: "cc-name" })}
            {field(c.number, card.number, (value) => { setCard((current) => ({ ...current, number: value })); setFee(null); }, "text", { autoComplete: "cc-number", inputMode: "numeric" })}
            {field(c.security, card.security, (value) => { setCard((current) => ({ ...current, security: value })); setFee(null); }, "password", { autoComplete: "cc-csc", maxLength: 4, inputMode: "numeric" })}
            {field(c.month, card.month, (value) => { setCard((current) => ({ ...current, month: value })); setFee(null); }, "number", { min: 1, max: 12, autoComplete: "cc-exp-month" })}
            {field(c.year, card.year, (value) => { setCard((current) => ({ ...current, year: value })); setFee(null); }, "number", { min: new Date().getFullYear(), autoComplete: "cc-exp-year" })}
            <label className="destination-order__field"><span>{c.type}</span><select required value={card.type} onChange={(event) => { setCard((current) => ({ ...current, type: event.target.value })); setFee(null); }}><option value="">—</option>{flight.acceptedCards.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
            {([ ["addressLine", c.address, "street-address"], ["city", c.city, "address-level2"], ["postalCode", c.postal, "postal-code"], ["countryCode", c.country, "country"] ] as const).map(([key, label, autoComplete]) => <span key={key}>{field(label, card.address[key], (value) => { setCard((current) => ({ ...current, address: { ...current.address, [key]: value } })); setFee(null); }, "text", { autoComplete })}</span>)}
          </div><button disabled={busy} className="checkout-apply">{busy ? c.processingShort : c.fees}</button>
            {fee ? <div className="destination-order__notice"><p>{c.fee}: {money({ amount: fee.surcharge, currency: fee.currency }, locale)}</p><p><strong>{c.total}: {money({ amount: fee.amount, currency: fee.currency }, locale)}</strong></p><label><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} /> {c.accept}</label><p><button type="button" className="checkout-pay" disabled={busy || !accepted} onClick={() => void pay()}>{busy ? c.processingShort : c.pay}</button></p></div> : null}
          </form> : null}
          {flight.challenge?.html ? <section><h3>{c.challenge}</h3><iframe title={c.challenge} className="destination-order__challenge" sandbox="allow-scripts allow-forms allow-top-navigation-by-user-activation" srcDoc={flight.challenge.html} referrerPolicy="no-referrer" /></section> : null}
          {flight.challenge && !flight.challenge.html ? <p role="status">{c.processing}</p> : null}
        </> : null}
      </section>
    </>}
  </div></main>;
}
