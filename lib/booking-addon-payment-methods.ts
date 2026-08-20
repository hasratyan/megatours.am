import type { CheckoutPaymentMethod, PaymentMethodFlags } from "./payment-method-flags";

export type BookingAddonPaymentMethod = CheckoutPaymentMethod | "admin";

const paymentMethodOrder: CheckoutPaymentMethod[] = [
  "idram",
  "idbank_card",
  "ameria_card",
];

export const resolveBookingAddonPaymentMethods = (
  flags: PaymentMethodFlags,
  canUseAdminPayment: boolean
): BookingAddonPaymentMethod[] => {
  const regularMethods: BookingAddonPaymentMethod[] = paymentMethodOrder.filter(
    (method) => flags[method] !== false
  );
  return canUseAdminPayment ? [...regularMethods, "admin"] : regularMethods;
};
