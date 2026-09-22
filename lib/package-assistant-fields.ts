import type { Locale } from "@/lib/i18n";

const labels: Record<string, Record<Locale, string>> = {
  destination: { en: "UAE destination", hy: "ԱՄԷ ուղղությունը", ru: "направление в ОАЭ" },
  hotel: { en: "hotel", hy: "հյուրանոցը", ru: "отель" },
  dates: { en: "travel dates", hy: "ճամփորդության ամսաթվերը", ru: "даты поездки" },
  year: { en: "travel year", hy: "ճամփորդության տարին", ru: "год поездки" },
  checkindate: { en: "check-in date", hy: "ժամանման ամսաթիվը", ru: "дата заезда" },
  checkoutdate: { en: "check-out date", hy: "մեկնման ամսաթիվը", ru: "дата выезда" },
  adults: { en: "number of adults", hy: "մեծահասակների քանակը", ru: "число взрослых" },
  children: { en: "number of children", hy: "երեխաների քանակը", ru: "число детей" },
  childage: { en: "children's ages", hy: "երեխաների տարիքները", ru: "возраст детей" },
  roomcount: { en: "number of rooms", hy: "սենյակների քանակը", ru: "число номеров" },
  travelers: { en: "traveler count", hy: "ուղևորների քանակը", ru: "число путешественников" },
  budget: { en: "your budget", hy: "Ձեր բյուջեն", ru: "ваш бюджет" },
};

export const normalizeMissingFieldKey = (value: string): string => {
  const key = value.trim().toLowerCase().replace(/[^a-z]/g, "");
  const aliases: Record<string, string> = {
    destinationcode: "destination", destinationname: "destination",
    hotelcode: "hotel", hotelname: "hotel", date: "dates",
    checkin: "checkindate", checkout: "checkoutdate",
    adultcount: "adults", childcount: "children", childrenages: "childage",
    childages: "childage", rooms: "roomcount", numberofrooms: "roomcount",
    guestcount: "travelers", guests: "travelers", budgetamount: "budget",
    budgetcurrency: "budget",
  };
  return aliases[key] ?? key;
};

export const labelMissingField = (value: string, locale: Locale): string => {
  const key = normalizeMissingFieldKey(value);
  return labels[key]?.[locale] ?? value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ").trim();
};

export const labelMissingFields = (values: string[], locale: Locale): string[] =>
  Array.from(new Set(values.map((value) => labelMissingField(value, locale)).filter(Boolean)));
