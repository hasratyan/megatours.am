import type { AoryxRoomOption } from "@/types/aoryx";
import { applyMarkup } from "@/lib/pricing-utils";

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const markAmount = (value: number | null | undefined, markup: number) => {
  if (!isFiniteNumber(value)) return value ?? null;
  return applyMarkup(value, markup) ?? value;
};

const normalizeTax = (gross: number | null | undefined, net: number | null | undefined, fallback: number | null) => {
  if (!isFiniteNumber(gross) || !isFiniteNumber(net)) return fallback;
  return gross - net;
};

export const applyHotelMarkupToRooms = (rooms: AoryxRoomOption[], markup: number): AoryxRoomOption[] => {
  if (!isFiniteNumber(markup) || markup <= 0) return rooms;

  return rooms.map((room) => {
    const markedTotalPrice = markAmount(room.totalPrice, markup);
    const markedGross = markAmount(room.price?.gross, markup);
    const markedNet = markAmount(room.price?.net, markup);
    const markedTax = normalizeTax(markedGross, markedNet, markAmount(room.price?.tax, markup));

    return {
      ...room,
      totalPrice: markedTotalPrice,
      displayTotalPrice: markedTotalPrice,
      price: room.price
        ? {
            ...room.price,
            gross: markedGross,
            net: markedNet,
            tax: markedTax,
          }
        : room.price,
    };
  });
};
