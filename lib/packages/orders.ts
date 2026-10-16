import "server-only";
import { randomBytes, createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse, after } from "next/server";
import { getDb } from "@/lib/db";
import { getServerSession } from "@/lib/auth-compat/server";
import { authOptions } from "@/lib/auth";
import { getAmdRateForCurrency } from "@/lib/pricing";
import { getPaymentMethodFlags } from "@/lib/payment-method-flags";
import { parseBookingAddonServices } from "@/lib/booking-addons";
import { requoteEfesInsuranceSelection, createEfesPoliciesFromBooking } from "@/lib/efes-client";
import type { AoryxBookingPayload, BookingInsuranceSelection } from "@/types/aoryx";
import { agentService, DestinationServiceError, type AgentOperation } from "./agent-service-client";
import type { DestinationOrder, PreparedDestinationOrder, DestinationPackageReview } from "./contracts";
import { destinationSearchSession, isSameOriginMutation } from "./search-session";
import { initializeHotelGateway, verifyHotelGateway, hotelGatewayConfigured, type HotelPaymentIntent, type HotelGateway } from "./hotel-gateway";
import { nonceHash, orderIdValid, seal, unseal, validIdramSignature, transferScheduleMatches } from "./order-security";

type Row = { _id: string; customerId: string; locale: string; hotelName?: string; createdAt?: Date; amountAmd: number; expiresAt: string; privatePayload: string; gateway?: HotelPaymentIntent; initializing?: boolean; paid?: boolean; paymentReference?: string; insuranceStatus?: string; policies?: unknown[]; callbackHash?: string; callbackExpires?: Date; callbackUsed?: boolean; callbackActive?: boolean; flightDispatchError?: boolean };
const rows = async () => (await getDb()).collection<Row>("destination_orders");
const headers = { "cache-control": "private, no-store" };
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const localeOf = (value: unknown) => value === "hy" || value === "ru" ? value : "en";
function publicOrigin() {
  const url = new URL(process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXTAUTH_URL || "https://megatours.am");
  if (url.protocol !== "https:" || url.hostname !== "megatours.am") throw new DestinationServiceError(503, "unavailable");
  return url.origin;
}
async function customer() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) throw new DestinationServiceError(401, "signin");
  return session.user.id;
}
async function owned(orderId: unknown, customerId: string) {
  if (!orderIdValid(orderId)) throw new DestinationServiceError(400, "invalid");
  const row = await (await rows()).findOne({ _id: orderId, customerId });
  if (!row) throw new DestinationServiceError(404, "not_found");
  return row;
}
const agentIdentity = (row: Row) => ({ orderId: row._id, customerId: row.customerId });
async function insuranceAfterHotel(row: Row, order: DestinationOrder) {
  const insurance = unseal<{ insurance?: BookingInsuranceSelection }>(row.privatePayload).insurance;
  if (!insurance || order.hotelStatus !== "confirmed" || !order.hotelPaid || row.insuranceStatus) return;
  const collection = await rows();
  const locked = await collection.updateOne({ _id: row._id, insuranceStatus: { $exists: false } }, { $set: { insuranceStatus: "confirming" } });
  if (!locked.modifiedCount) return;
  try {
    const payload = { sessionId: row._id, groupCode: 0, hotelCode: "", destinationCode: "CY", countryCode: "CY", currency: "AMD", nationality: "AM", rooms: [], customerRefNumber: row._id, checkInDate: order.hotel.checkIn, checkOutDate: order.hotel.checkOut, insurance } as AoryxBookingPayload;
    const policies = await createEfesPoliciesFromBooking(payload, { orderId: row._id, flow: "destination_checkout" });
    await collection.updateOne({ _id: row._id }, { $set: { insuranceStatus: "confirmed", policies } });
  } catch (error) {
    await collection.updateOne({ _id: row._id }, { $set: { insuranceStatus: "unknown" } });
    console.error("[Destination insurance confirmation]", { orderId: row._id, error: error instanceof Error ? error.message : "Unexpected error" });
  }
}
async function verifiedHotelPayment(row: Row, reference: string) {
  if (!row.gateway || !reference) throw new DestinationServiceError(409, "payment_unverified");
  await (await rows()).updateOne({ _id: row._id }, { $set: { paid: true, paymentReference: reference } });
  const order = await agentService<DestinationOrder>("orders/hotel/confirm", { ...agentIdentity(row), paymentReference: reference, provider: row.gateway.provider, amountAmd: row.amountAmd });
  await insuranceAfterHotel(row, order);
  return order;
}
async function queueHotelConfirmation(row: Row, reference: string) {
  await (await rows()).updateOne({ _id: row._id }, { $set: { paid: true, paymentReference: reference } });
  after(async () => {
    try { await verifiedHotelPayment(row, reference); }
    catch (error) { console.error("[Destination hotel status pending]", { orderId: row._id, code: error instanceof DestinationServiceError ? error.code : "unavailable" }); }
  });
}
async function status(row: Row, refresh = false) {
  if (refresh && row.gateway && !row.paid && await verifyHotelGateway(row.gateway)) { await queueHotelConfirmation(row, row.gateway.gatewayId); row.paid = true; }
  let order = await agentService<DestinationOrder>("orders/status", agentIdentity(row));
  if (row.paid && order.hotelStatus === "awaiting_payment") { await queueHotelConfirmation(row, row.paymentReference || row.gateway!.gatewayId); order = { ...order, hotelPaid: true, hotelStatus: "confirming" }; }
  if (refresh && order.hotelPaid && order.hotelStatus !== "confirmed" && order.hotelStatus !== "awaiting_payment") order = await agentService<DestinationOrder>("orders/hotel/refresh", agentIdentity(row));
  if (row.paid && !order.hotelPaid) order = { ...order, hotelPaid: true, hotelStatus: "confirming" };
  if (order.hotelPaid && order.hotelStatus === "confirmed") after(async () => { await insuranceAfterHotel(row, order); });
  const current = await (await rows()).findOne({ _id: row._id });
  return { order, hotelAmount: { amount: row.amountAmd, currency: "AMD" }, insuranceStatus: current?.insuranceStatus ?? null };
}
async function startCheckout(body: Record<string, unknown>, customerId: string, request: NextRequest) {
  const provider: HotelGateway | null = body.paymentMethod === "idram" ? "idram" : body.paymentMethod === "idbank_card" ? "idbank" : body.paymentMethod === "ameria_card" ? "ameriabank" : null;
  if (!provider || !hotelGatewayConfigured(provider) || !(await getPaymentMethodFlags())[body.paymentMethod as "idram" | "idbank_card" | "ameria_card"]) throw new DestinationServiceError(400, "invalid");
  const owner = destinationSearchSession(request), selectedServices = body.selectedServices;
  if (Array.isArray(selectedServices) && selectedServices.includes("transfer")) {
    const review = await agentService<DestinationPackageReview>("packages/review", { ownerId: owner.ownerId, hotelOfferId: body.hotelOfferId, selectedServices, serviceOfferIds: body.serviceOfferIds, attractionOfferId: body.attractionOfferId });
    const transfer = review.services.find((service) => service.service === "transfer");
    if (!transfer || !transferScheduleMatches(transfer.journeys, object(body.transferDetails))) throw new DestinationServiceError(409, "transfer_changed");
  }
  const prepared = await agentService<PreparedDestinationOrder>("orders/prepare", { ownerId: owner.ownerId, customerId, hotelOfferId: body.hotelOfferId, selectedServices, serviceOfferIds: body.serviceOfferIds, attractionOfferId: body.attractionOfferId, rooms: body.rooms, contact: body.contact, transferDetails: body.transferDetails, attractionAnswers: body.attractionAnswers, checkoutFingerprint: createHash("sha256").update(JSON.stringify(parseBookingAddonServices({ insurance: body.insurance }).insurance ?? null)).digest("hex") });
  const collection = await rows();
  let row = await collection.findOne({ _id: prepared.order.id, customerId });
  if (!row) {
    let insurance = parseBookingAddonServices({ insurance: body.insurance }).insurance;
    if (body.insurance && !insurance) throw new DestinationServiceError(400, "insurance_invalid");
    if (insurance) {
      const guests = prepared.order.guests;
      if (insurance.provider !== "efes" || insurance.startDate !== prepared.order.hotel.checkIn || insurance.endDate !== prepared.order.hotel.checkOut || !insurance.travelCountries || !/^(cy|cyp|cyprus|կիպրոս|кипр)$/iu.test(insurance.travelCountries.trim()) || insurance.travelers?.length !== guests.length || insurance.travelers.some((traveler, index) => (traveler.firstNameEn || traveler.firstName).trim().toLowerCase() !== guests[index].firstName.trim().toLowerCase() || (traveler.lastNameEn || traveler.lastName).trim().toLowerCase() !== guests[index].lastName.trim().toLowerCase())) throw new DestinationServiceError(400, "insurance_invalid");
      const previousPrice = insurance.price, previousCurrency = insurance.currency;
      insurance.travelCountries = "Cyprus";
      insurance = await requoteEfesInsuranceSelection(insurance, { startDate: prepared.order.hotel.checkIn, endDate: prepared.order.hotel.checkOut });
      if (insurance.price !== previousPrice || insurance.currency !== previousCurrency) throw new DestinationServiceError(409, "insurance_changed");
    }
    const totals = [...prepared.totals, ...(insurance ? [{ amount: Number(insurance.price), currency: String(insurance.currency) }] : [])];
    let total = 0;
    for (const price of totals) {
      const rate = price.currency === "AMD" ? 1 : await getAmdRateForCurrency(price.currency);
      if (!rate || !Number.isFinite(price.amount) || price.amount <= 0) throw new DestinationServiceError(503, "unavailable");
      total += price.amount * rate;
    }
    const amountAmd = Math.ceil(total), locale = localeOf(body.locale);
    await collection.updateOne({ _id: prepared.order.id }, { $setOnInsert: { customerId, locale, hotelName: prepared.order.hotel.name, createdAt: new Date(), amountAmd, expiresAt: prepared.expiresAt, privatePayload: seal({ insurance }) } }, { upsert: true });
    row = await owned(prepared.order.id, customerId);
  }
  if (row.paid || prepared.order.hotelPaid) return { orderId: row._id, formUrl: `${publicOrigin()}/${row.locale}/orders/${row._id}` };
  if (row.gateway) return { orderId: row._id, ...row.gateway };
  if (Date.parse(row.expiresAt) <= Date.now()) throw new DestinationServiceError(409, "expired");
  const lock = await collection.updateOne({ _id: row._id, initializing: { $ne: true }, gateway: { $exists: false } }, { $set: { initializing: true } });
  if (!lock.modifiedCount) throw new DestinationServiceError(409, "processing");
  // A failed/uncertain initialization is not repeated automatically. It cannot charge without the customer's bank interaction.
  const gateway = await initializeHotelGateway({ provider, orderId: row._id, amountAmd: row.amountAmd, locale: row.locale, email: prepared.order.contact.email, returnUrl: `${publicOrigin()}/api/destinations/cyprus/hotel-return?order=${row._id}` });
  await collection.updateOne({ _id: row._id }, { $set: { gateway, initializing: false } });
  return { orderId: row._id, ...gateway };
}
export async function destinationOrderRoute(request: NextRequest, operation: string) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ code: "invalid" }, { status: 403, headers });
  try {
    const customerId = await customer(), raw = await request.text();
    if (raw.length > 40_000) throw new DestinationServiceError(400, "invalid");
    const body = object(JSON.parse(raw));
    if (operation === "checkout") return NextResponse.json(await startCheckout(body, customerId, request), { headers });
    const row = await owned(body.orderId, customerId);
    if (operation === "status" || operation === "hotel/refresh") return NextResponse.json(await status(row, operation !== "status"), { headers });
    const allowed: Record<string, string[]> = { "flights/search": ["origin", "airport"], "flights/select": ["offerId"], "flights/book": ["passengers", "contact"], "flights/fees": ["card"], "flights/pay": ["card", "feeQuoteId", "payer"], "flights/refresh": [] };
    if (!Object.hasOwn(allowed, operation)) throw new DestinationServiceError(404, "not_found");
    const payload: Record<string, unknown> = { ...agentIdentity(row), ...Object.fromEntries(allowed[operation].filter((key) => body[key] !== undefined).map((key) => [key, body[key]])) };
    if (operation === "flights/pay") {
      const current = await agentService<DestinationOrder>("orders/status", agentIdentity(row));
      if (!current.flight.canPay) throw new DestinationServiceError(409, "processing");
      const nonce = randomBytes(32).toString("base64url");
      const callbackLock = await (await rows()).updateOne({ _id: row._id, callbackActive: { $ne: true } }, { $set: { callbackActive: true, flightDispatchError: false, callbackHash: nonceHash(nonce), callbackExpires: new Date(Date.now() + 30 * 60_000), callbackUsed: false } });
      if (!callbackLock.modifiedCount) throw new DestinationServiceError(409, "processing");
      payload.responseUrl = `${publicOrigin()}/api/destinations/cyprus/flight-return?token=${nonce}`;
      // Send the response before waiting for the airline's 180-second payment window.
      // Card data lives only in this request closure; it is never persisted or logged.
      after(async () => {
        try { await agentService("orders/flights/pay", payload); }
        catch (error) { await (await rows()).updateOne({ _id: row._id }, { $set: { flightDispatchError: true } }); console.error("[Destination flight status pending]", { orderId: row._id, code: error instanceof DestinationServiceError ? error.code : "unavailable" }); }
      });
      return NextResponse.json({ ...current, flight: { ...current.flight, status: "paying", canPay: false } }, { status: 202, headers });
    }
    const result = await agentService<DestinationOrder>(`orders/${operation}` as AgentOperation, payload);
    if (operation === "flights/refresh" && ["ready", "failed"].includes(result.flight.status)) await (await rows()).updateOne({ _id: row._id }, { $set: { callbackActive: false } });
    return NextResponse.json({ ...result, flightError: row.flightDispatchError === true && !["paid", "ticketed"].includes(result.flight.status) }, { headers });
  } catch (error) {
    if (!(error instanceof DestinationServiceError)) console.error("[Destination checkout]", { operation, error: error instanceof Error ? error.message : "Unexpected error" });
    return NextResponse.json({ code: error instanceof DestinationServiceError ? error.code : "unavailable" }, { status: error instanceof DestinationServiceError ? error.status : 503, headers });
  }
}
export async function hotelBankReturn(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("order");
  if (!orderIdValid(id)) return new NextResponse("Invalid payment return", { status: 400 });
  const row = await (await rows()).findOne({ _id: id });
  if (!row) return new NextResponse("Booking not found", { status: 404 });
  // Query parameters never establish payment. Only the stored bank ID and a bank-to-server status lookup do.
  try { if (row.gateway && !row.paid && await verifyHotelGateway(row.gateway)) await queueHotelConfirmation(row, row.gateway.gatewayId); }
  catch (error) { console.error("[Destination bank return]", { orderId: id, error: error instanceof Error ? error.message : "Unexpected error" }); }
  return NextResponse.redirect(`${publicOrigin()}/${row.locale}/orders/${id}`, 303);
}
export async function destinationIdramCallback(form: FormData) {
  const fields = Object.fromEntries([...form.entries()].filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  const id = fields.EDP_BILL_NO?.replace(/^CY-/, ""), account = process.env.IDRAM_REC_ACCOUNT, secret = process.env.IDRAM_SECRET_KEY;
  if (!orderIdValid(id) || !account || !secret) return new NextResponse("ERROR", { status: 400 });
  const row = await (await rows()).findOne({ _id: id });
  if (!row || row.gateway?.provider !== "idram" || fields.EDP_REC_ACCOUNT !== account || !/^\d+(?:\.\d{1,2})?$/.test(fields.EDP_AMOUNT ?? "") || Math.round(Number(fields.EDP_AMOUNT) * 100) !== Math.round(row.amountAmd * 100)) return new NextResponse("ERROR", { status: 400 });
  if (fields.EDP_PRECHECK === "YES") return new NextResponse("YES");
  if (!fields.EDP_TRANS_ID || !validIdramSignature(fields, secret)) return new NextResponse("ERROR", { status: 400 });
  try { await queueHotelConfirmation(row, fields.EDP_TRANS_ID); return new NextResponse("OK"); }
  catch { return new NextResponse("ERROR", { status: 503 }); }
}
export async function flightBankReturn(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return new NextResponse("Invalid verification return", { status: 400 });
  const collection = await rows(), filter = { callbackHash: nonceHash(token), callbackExpires: { $gt: new Date() } };
  const row = await collection.findOneAndUpdate({ ...filter, callbackUsed: false }, { $set: { callbackUsed: true } }, { returnDocument: "after" });
  if (!row) {
    const previous = await collection.findOne(filter);
    return previous ? NextResponse.redirect(`${publicOrigin()}/${previous.locale}/orders/${previous._id}`, 303) : new NextResponse("Verification expired", { status: 410 });
  }
  try {
    const form = request.method === "POST" ? await request.formData() : null;
    const response = form?.get("PaRes") ?? form?.get("challengeResponse") ?? form?.get("response") ?? request.nextUrl.searchParams.get("challengeResponse");
    if (typeof response === "string" && response.length > 0 && response.length <= 64_000) after(async () => { try { await agentService("orders/flights/verify", { ...agentIdentity(row), challengeResponse: response }); } catch { console.error("[Destination flight verification pending]", { orderId: row._id }); } });
    else await agentService("orders/flights/refresh", agentIdentity(row));
  } catch (error) { console.error("[Destination flight verification]", { orderId: row._id, error: error instanceof Error ? error.message : "Unexpected error" }); }
  return NextResponse.redirect(`${publicOrigin()}/${row.locale}/orders/${row._id}`, 303);
}
