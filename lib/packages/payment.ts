import { getDestination, type DestinationId } from "@/lib/destinations/registry";
import type { PackageBuilderService } from "@/lib/package-builder-state";

/** Flight selection belongs to the trip, but its payment belongs to Kyte. */
export function packagePaymentProvider(destination: DestinationId, service: PackageBuilderService): "megatours" | "kyte" {
  if (service !== "flight") return "megatours";
  const config = getDestination(destination);
  if (!config) throw new Error("Unsupported payment destination");
  return config.flightPaymentProvider;
}

export const packagePaymentCopy = {
  en: {
    checkoutTotal: "MEGATOURS checkout total",
    flightTitle: "Separate flight payment",
    notice: "Flight tickets are paid separately. Their price is not included in the MEGATOURS checkout total.",
  },
  hy: {
    checkoutTotal: "MEGATOURS-ի վճարման ընդհանուր գումարը",
    flightTitle: "Ավիատոմսերի առանձին վճարում",
    notice: "Ավիատոմսերի վճարումը կատարվում է առանձին։ Դրանց արժեքը ներառված չէ MEGATOURS-ի վճարման ընդհանուր գումարում։",
  },
  ru: {
    checkoutTotal: "Итого к оплате MEGATOURS",
    flightTitle: "Отдельная оплата авиабилетов",
    notice: "Авиабилеты оплачиваются отдельно. Их стоимость не включена в сумму оплаты MEGATOURS.",
  },
};
