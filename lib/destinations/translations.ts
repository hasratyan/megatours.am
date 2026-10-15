import type { Locale, Translation } from "@/lib/i18n";
import type { DestinationId } from "./registry";
import { packagePaymentCopy } from "@/lib/packages/payment";

/** Keep the existing product copy and layout, replacing destination-specific wording. */
export function destinationTranslations(base: Translation, destination: DestinationId, locale: Locale): Translation {
  if (destination !== "cyprus") return base;
  const replace = (value: unknown): unknown => {
    if (typeof value === "string") return value
      .replace(/ԱՄԷ-ի/g, "Կիպրոսի").replace(/ԱՄԷ-ում/g, "Կիպրոսում").replace(/ԱՄԷ/g, "Կիպրոս")
      .replace(/United Arab Emirates/g, "Cyprus").replace(/the UAE/g, "Cyprus").replace(/UAE/g, "Cyprus")
      .replace(/Объединенные Арабские Эмираты/g, "Кипр").replace(/по всему ОАЭ/g, "по всему Кипру").replace(/в ОАЭ/g, "на Кипре").replace(/ОАЭ/g, "Кипра");
    if (Array.isArray(value)) return value.map(replace);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, replace(entry)]));
    return value;
  };
  const result = replace(base) as Translation;
  result.hero.title = { hy: "Կիպրոսի հյուրանոցների բացառիկ արժեքներ՝ ուղիղ տուրօպերատորից", en: "Exclusive Cyprus Hotel Rates — Direct from a Tour Operator", ru: "Эксклюзивные цены на отели Кипра — напрямую от туроператора" }[locale];
  result.packageBuilder.insurance.defaultTravelCountry = { hy: "Կիպրոս", en: "Cyprus", ru: "Кипр" }[locale];
  result.packageBuilder.insurance.travelCountriesPlaceholder = result.packageBuilder.insurance.defaultTravelCountry;
  result.packageBuilder.flights.unsupportedDestination = { hy: "Ընտրեք Կիպրոսի հյուրանոց՝ փաթեթի թռիչքները որոնելու համար։", en: "Choose a Cyprus hotel to search for package flights.", ru: "Выберите отель на Кипре для поиска перелёта в пакете." }[locale];
  const paymentFaq = result.faq.items[3];
  if (paymentFaq) paymentFaq.body = `${paymentFaq.body} ${packagePaymentCopy[locale].notice}`;
  const cities = {
    hy: [["Այիա Նապա", "Ամենապահանջված", "Ծովափնյա հանգիստ, ավազոտ լողափեր և հյուրանոցներ Միջերկրականի ափին։", "Դիտել Այիա Նապայի առաջարկները"], ["Պրոտարաս", "Ընտանեկան հանգիստ", "Հանգիստ ծովածոցեր և ծովափնյա հյուրանոցներ ընտանիքի համար։", "Դիտել Պրոտարասի առաջարկները"], ["Պաֆոս", "Մշակույթ և ծով", "Պատմական վայրեր, ծովափնյա զբոսանքներ և հանգստավայրեր։", "Դիտել Պաֆոսի առաջարկները"]],
    en: [["Ayia Napa", "Popular choice", "Sandy beaches and Mediterranean hotels for your coastal escape.", "View Ayia Napa offers"], ["Protaras", "Family stays", "Quiet bays and seaside hotels for the whole family.", "View Protaras offers"], ["Paphos", "Culture and coast", "Historic sights, coastal walks and Mediterranean resorts.", "View Paphos offers"]],
    ru: [["Айя-Напа", "Популярное направление", "Песчаные пляжи и отели на берегу Средиземного моря.", "Предложения Айя-Напы"], ["Протарас", "Для всей семьи", "Спокойные бухты и приморские отели для семейного отдыха.", "Предложения Протараса"], ["Пафос", "Культура и море", "Исторические места, прогулки у моря и курортные отели.", "Предложения Пафоса"]],
  }[locale];
  result.exclusives.offers = cities.map(([title, badge, description, cta], index) => ({ ...result.exclusives.offers[index], title, badge, description, cta }));
  return result;
}
