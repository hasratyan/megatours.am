import "server-only";
import { randomInt } from "node:crypto";
import { postIdbankFormWithAudit } from "@/lib/idbank-gateway-audit";
import { getVposPaymentDetails } from "@/lib/vpos-payment-details";

export type HotelGateway = "idbank" | "ameriabank" | "idram";
export type HotelPaymentIntent = { provider: HotelGateway; gatewayId: string; merchantOrder: string; amountAmd: number; decimals: number; formUrl?: string; action?: string; fields?: Record<string, string> };
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
function baseUrl(provider: Exclude<HotelGateway, "idram">) {
  const value = text(provider === "idbank" ? process.env.VPOS_BASE_URL : process.env.AMERIA_VPOS_BASE_URL);
  if (!value || new URL(value).protocol !== "https:" || (process.env.NODE_ENV === "production" && /servicestest|ipaytest/i.test(value))) throw new Error("Card payment is not configured for live bookings.");
  return value.replace(/\/+$/, "");
}
export function hotelGatewayConfigured(provider: HotelGateway) {
  if (process.env.B2C_CYPRUS_CHECKOUT_ENABLED !== "true") return false;
  try {
    if (provider === "idram") return Boolean(text(process.env.IDRAM_REC_ACCOUNT) && text(process.env.IDRAM_SECRET_KEY));
    baseUrl(provider); gatewayCurrency(provider);
    return provider === "idbank" ? Boolean(text(process.env.VPOS_USER) && text(process.env.VPOS_PASSWORD)) : Boolean(text(process.env.AMERIA_VPOS_CLIENT_ID) && text(process.env.AMERIA_VPOS_USERNAME) && text(process.env.AMERIA_VPOS_PASSWORD));
  } catch { return false; }
}
export function gatewayCurrency(provider: Exclude<HotelGateway, "idram">) {
  const code = text(provider === "idbank" ? process.env.VPOS_CURRENCY_CODE : process.env.AMERIA_VPOS_CURRENCY_CODE) || "051";
  const rawDecimals = provider === "idbank" ? process.env.VPOS_CURRENCY_DECIMALS : process.env.AMERIA_VPOS_CURRENCY_DECIMALS;
  const decimals = rawDecimals === undefined || rawDecimals === "" ? 2 : Number(rawDecimals);
  if (!["051", "51", "AMD"].includes(code) || !Number.isInteger(decimals) || decimals < 0 || decimals > 2) throw new Error("Hotel checkout currency is not configured.");
  return { decimals, code: "051" };
}
export function allowedIdbankFormUrl(value: string, base: string) {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && [new URL(base).origin, "https://epg.arca.am"].includes(url.origin); }
  catch { return false; }
}
export async function initializeHotelGateway(input: { provider: HotelGateway; orderId: string; amountAmd: number; locale: string; returnUrl: string; email: string }): Promise<HotelPaymentIntent> {
  if (!Number.isFinite(input.amountAmd) || input.amountAmd <= 0) throw new Error("Invalid checkout amount.");
  const merchantOrder = input.provider === "idbank" ? `CY-${input.orderId.replace(/-/g, "").slice(0, 28)}` : `CY-${input.orderId}`;
  if (input.provider === "idram") {
    const account = text(process.env.IDRAM_REC_ACCOUNT), secret = text(process.env.IDRAM_SECRET_KEY);
    if (!account || !secret) throw new Error("Wallet payment is not configured.");
    return { provider: "idram", gatewayId: merchantOrder, merchantOrder, amountAmd: input.amountAmd, decimals: 2, action: "https://banking.idram.am/Payment/GetPayment", fields: { EDP_REC_ACCOUNT: account, EDP_BILL_NO: merchantOrder, EDP_AMOUNT: input.amountAmd.toFixed(2), EDP_DESCRIPTION: "MEGATOURS hotel and selected services", EDP_LANGUAGE: input.locale === "hy" ? "AM" : input.locale.toUpperCase(), EDP_EMAIL: input.email } };
  }
  const base = baseUrl(input.provider), currency = gatewayCurrency(input.provider);
  if (input.provider === "idbank") {
    const userName = text(process.env.VPOS_USER), password = text(process.env.VPOS_PASSWORD);
    if (!userName || !password) throw new Error("Card payment is not configured.");
    const body = new URLSearchParams({ userName, password, orderNumber: merchantOrder, amount: String(Math.round(input.amountAmd * 10 ** currency.decimals)), currency: currency.code, returnUrl: input.returnUrl, description: "MEGATOURS hotel and selected services", language: input.locale });
    const result = await postIdbankFormWithAudit({ operation: "register", url: `${base}/register.do`, body: body.toString(), context: { orderNumber: merchantOrder, amountMinor: Math.round(input.amountAmd * 10 ** currency.decimals), currencyCode: currency.code, returnUrl: input.returnUrl } });
    const response = result.parsedBody;
    if (!result.response.ok || !response || (response.errorCode !== undefined && String(response.errorCode) !== "0") || !text(response.orderId) || !text(response.formUrl) || !allowedIdbankFormUrl(text(response.formUrl), base)) throw new Error("Card payment could not be started. Please try again.");
    return { provider: "idbank", gatewayId: text(response.orderId), merchantOrder, amountAmd: input.amountAmd, decimals: currency.decimals, formUrl: text(response.formUrl) };
  }
  const clientId = text(process.env.AMERIA_VPOS_CLIENT_ID), userName = text(process.env.AMERIA_VPOS_USERNAME), password = text(process.env.AMERIA_VPOS_PASSWORD);
  if (!clientId || !userName || !password) throw new Error("Card payment is not configured.");
  // The merchant API requires a numeric order ID; retry only explicit duplicate-ID rejections.
  for (let attempt = 0; attempt < 5; attempt++) {
    const numericOrder = randomInt(100_000_000, 999_999_999);
    const response = await fetch(`${base}/api/VPOS/InitPayment`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ClientID: clientId, Username: userName, Password: password, Currency: currency.code, Description: "MEGATOURS hotel and selected services", OrderID: numericOrder, Amount: input.amountAmd, BackURL: input.returnUrl, Opaque: JSON.stringify({ destinationOrderId: input.orderId, locale: input.locale }), Timeout: 1200 }), signal: AbortSignal.timeout(30_000) });
    const result = await response.json() as Record<string, unknown>, code = String(result.ResponseCode);
    if (response.ok && code === "1" && text(result.PaymentID)) return { provider: "ameriabank", gatewayId: text(result.PaymentID), merchantOrder: String(numericOrder), amountAmd: input.amountAmd, decimals: currency.decimals, formUrl: `${base}/Payments/Pay?id=${encodeURIComponent(text(result.PaymentID))}&lang=${input.locale === "hy" ? "am" : input.locale}` };
    if (!["01", "08204"].includes(code)) break;
  }
  throw new Error("Card payment could not be started. Please try again.");
}
export function hotelGatewayPaidInFull(provider: HotelGateway, raw: Record<string, unknown>, amountAmd: number, decimals: number): boolean {
  const currency = String(provider === "ameriabank" ? raw.Currency : raw.currency).toUpperCase();
  if (!["AMD", "51", "051"].includes(currency)) return false;
  if (provider === "ameriabank") return ["0", "00"].includes(String(raw.ResponseCode)) && (Number(raw.OrderStatus) === 2 || String(raw.PaymentState).toLowerCase() === "payment_deposited") && Math.round(Number(raw.Amount) * 10 ** decimals) === Math.round(amountAmd * 10 ** decimals);
  const info = raw.paymentAmountInfo ?? raw.PaymentAmountInfo;
  const amounts = info && typeof info === "object" ? info as Record<string, unknown> : {};
  const deposited = amounts.depositedAmount ?? amounts.DepositedAmount ?? raw.amount;
  return Number(raw.errorCode ?? 0) === 0 && Number(raw.actionCode ?? 0) === 0 && (Number(raw.orderStatus) === 2 || ["deposited", "payment_deposited", "2"].includes(String(amounts.paymentState ?? amounts.PaymentState ?? raw.paymentState ?? raw.PaymentState).toLowerCase())) && Number(deposited) === Math.round(amountAmd * 10 ** decimals);
}
export async function verifyHotelGateway(intent: HotelPaymentIntent) {
  if (intent.provider === "idram") return false; // Wallet confirmation uses the signed server callback.
  const details = await getVposPaymentDetails({ provider: intent.provider, orderId: intent.gatewayId, language: "en" });
  return hotelGatewayPaidInFull(intent.provider, details.raw, intent.amountAmd, intent.decimals);
}
