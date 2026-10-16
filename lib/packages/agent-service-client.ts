import "server-only";
import type { DestinationHotelSearch, DestinationHotelSearchResult, DestinationHotelPrebookResult } from "./contracts";

export class DestinationServiceError extends Error {
  constructor(readonly status: number, readonly code: string) { super("Destination service unavailable."); }
}

export type AgentOperation = "hotels/search" | "hotels/prebook" | "services/search" | "services/prebook" | "packages/review" | "attractions/search" | "attractions/prebook" | `orders/${"prepare" | "status" | "hotel/confirm" | "hotel/refresh" | "flights/search" | "flights/select" | "flights/book" | "flights/fees" | "flights/pay" | "flights/verify" | "flights/refresh"}`;
export async function agentService<T>(operation: AgentOperation, payload: object, signal?: AbortSignal): Promise<T> {
  const token = process.env.B2C_AGENT_SERVICES_TOKEN?.trim();
  const base = process.env.B2C_AGENT_URL?.trim();
  if (!token || !base) throw new DestinationServiceError(503, "unavailable");
  const origin = new URL(base);
  if (origin.protocol !== "https:" && !(origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname))) throw new DestinationServiceError(503, "unavailable");
  try {
    const isPayment = operation === "orders/flights/pay" || operation === "orders/flights/verify";
    const timeout = AbortSignal.timeout(isPayment ? 210_000 : operation === "orders/hotel/confirm" ? 240_000 : operation === "orders/prepare" ? 120_000 : 55_000);
    const response = await fetch(new URL(`/api/b2c/v1/${operation}`, origin), { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(payload), cache: "no-store", redirect: "error", signal: signal && !isPayment ? AbortSignal.any([signal, timeout]) : timeout });
    if (!response.ok) throw new DestinationServiceError([400, 409, 429].includes(response.status) ? response.status : 503, response.status === 409 ? "expired" : response.status === 400 ? "invalid" : "unavailable");
    return await response.json() as T;
  } catch (error) {
    if (error instanceof DestinationServiceError) throw error;
    throw new DestinationServiceError(503, "unavailable");
  }
}
export const searchDestinationHotels = (search: DestinationHotelSearch, ownerId: string, signal?: AbortSignal) =>
  agentService<DestinationHotelSearchResult>("hotels/search", { ...search, ownerId }, signal);
export const prebookDestinationHotel = (offerId: string, ownerId: string, signal?: AbortSignal) =>
  agentService<DestinationHotelPrebookResult>("hotels/prebook", { offerId, ownerId }, signal);
