export type BookingAddonOutcomeServiceKey =
  | "transfer"
  | "excursion"
  | "insurance"
  | "flight";

export type BookingAddonPaymentServiceOutcome = {
  appliedServices: BookingAddonOutcomeServiceKey[];
  failedServices: BookingAddonOutcomeServiceKey[];
};

const uniqueServiceKeys = (services: BookingAddonOutcomeServiceKey[]) =>
  Array.from(new Set(services));

export const resolveBookingAddonPaymentServiceOutcome = (input: {
  appliedServices: BookingAddonOutcomeServiceKey[];
  failedServices?: BookingAddonOutcomeServiceKey[];
  insuranceStatus:
    | "not_selected"
    | "not_requested"
    | "pending"
    | "confirmed"
    | "failed";
}): BookingAddonPaymentServiceOutcome => {
  const appliedServices = uniqueServiceKeys(input.appliedServices);
  const failedServices = uniqueServiceKeys(input.failedServices ?? []);

  if (input.insuranceStatus === "failed") {
    const insuranceBelongsToPayment =
      appliedServices.includes("insurance") || failedServices.includes("insurance");
    if (!insuranceBelongsToPayment) {
      return { appliedServices, failedServices };
    }
    return {
      appliedServices: appliedServices.filter((service) => service !== "insurance"),
      failedServices: uniqueServiceKeys([...failedServices, "insurance"]),
    };
  }

  if (input.insuranceStatus === "confirmed") {
    const insuranceBelongsToPayment =
      appliedServices.includes("insurance") || failedServices.includes("insurance");
    return {
      appliedServices: insuranceBelongsToPayment
        ? uniqueServiceKeys([...appliedServices, "insurance"])
        : appliedServices,
      failedServices: failedServices.filter((service) => service !== "insurance"),
    };
  }

  return { appliedServices, failedServices };
};
