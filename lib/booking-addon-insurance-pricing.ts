import { requoteEfesInsuranceSelection } from "@/lib/efes-client";
import type { BookingAddonCheckoutRequest } from "@/lib/booking-addons";

export async function refreshBookingAddonInsurancePricing(
  request: BookingAddonCheckoutRequest,
  fallbackDates: { startDate?: string | null; endDate?: string | null }
) {
  const insurance = request.services.insurance;
  if (!insurance || insurance.provider !== "efes") return;
  request.services.insurance = await requoteEfesInsuranceSelection(insurance, fallbackDates);
}
