import type { Locale } from "@/lib/i18n";

export const DESTINATION_IDS = ["uae", "cyprus"] as const;
export type DestinationId = (typeof DESTINATION_IDS)[number];
export type DestinationService = "hotel" | "transfer" | "flight";
type Copy = Record<Locale, string>;

export type DestinationConfig = {
  id: DestinationId;
  countryCode: string;
  name: Copy;
  title: Copy;
  description: Copy;
  locations: Copy;
  image: string;
  hotelProvider: "aoryx" | "agent";
  flightPaymentProvider: "megatours" | "kyte";
  cities: readonly { id: string; name: string }[];
  airports: readonly string[];
};

const text = (en: string, hy: string, ru: string): Copy => ({ en, hy, ru });

export const destinations: readonly DestinationConfig[] = [
  {
    id: "uae", countryCode: "AE", hotelProvider: "aoryx", flightPaymentProvider: "megatours",
    name: text("UAE", "ԱՄԷ", "ОАЭ"),
    title: text("Extraordinary days. Arabian nights.", "Անմոռանալի օրեր։ Արաբական գիշերներ։", "Яркие дни. Арабские ночи."),
    description: text("Skyline stays, beach resorts and desert adventures. Build your own UAE escape.", "Քաղաքային հյուրանոցներ, ծովափնյա հանգիստ և անապատային արկածներ։ Պլանավորեք Ձեր ուղևորությունը ԱՄԷ։", "Городские отели, пляжные курорты и приключения в пустыне. Спланируйте отдых в ОАЭ."),
    locations: text("Dubai · Abu Dhabi · Sharjah", "Դուբայ · Աբու Դաբի · Շարժա", "Дубай · Абу-Даби · Шарджа"),
    image: "/images/burj-khalifa.webp",
    cities: [{ id: "160-0", name: "Dubai" }, { id: "604-0", name: "Abu Dhabi" }, { id: "605-0", name: "Sharjah" }],
    airports: ["DXB", "AUH", "SHJ"],
  },
  {
    id: "cyprus", countryCode: "CY", hotelProvider: "agent", flightPaymentProvider: "kyte",
    name: text("Cyprus", "Կիպրոս", "Кипр"),
    title: text("A little slower. A little closer to the sea.", "Մի փոքր դանդաղ։ Մի փոքր ավելի մոտ ծովին։", "Чуть медленнее. Чуть ближе к морю."),
    description: text("Turquoise bays, coastal towns and Mediterranean stays. Choose your hotel and travel your way.", "Փիրուզագույն ծովածոցեր, ծովափնյա քաղաքներ և միջերկրածովյան հանգիստ։ Ընտրեք հյուրանոցը և Ձեր ճանապարհորդության ձևը։", "Бирюзовые бухты, приморские города и средиземноморский отдых. Выберите отель и свой формат путешествия."),
    locations: text("Ayia Napa · Protaras · Larnaca · Paphos", "Այիա Նապա · Պրոտարաս · Լառնակա · Պաֆոս", "Айя-Напа · Протарас · Ларнака · Пафос"),
    image: "/images/destinations/cyprus.webp",
    // City identities come from the agent catalogue. Names are editorial hints only.
    cities: [], airports: ["LCA", "PFO"],
  },
];

export const destinationCopy = {
  eyebrow: text("YOUR NEXT CHAPTER", "ՁԵՐ ՀԱՋՈՐԴ ՈՒՂԵՎՈՐՈՒԹՅՈՒՆԸ", "ВАШЕ СЛЕДУЮЩЕЕ ПУТЕШЕСТВИЕ"),
  choose: text("Where would you like to go?", "Որտե՞ղ կցանկանաք մեկնել։", "Куда хотите отправиться?"),
  intro: text("Two destinations. A world of possibilities.", "Երկու ուղղություն։ Անթիվ հնարավորություններ։", "Два направления. Мир возможностей."),
  explore: text("Explore", "Բացահայտել", "Открыть"),
  switch: text("Destination", "Ուղղություն", "Направление"),
  all: text("All destinations", "Բոլոր ուղղությունները", "Все направления"),
  search: text("Find your stay", "Գտեք Ձեր հյուրանոցը", "Найдите свой отель"),
  city: text("City or resort", "Քաղաք կամ հանգստավայր", "Город или курорт"),
  chooseCity: text("Choose a city", "Ընտրեք քաղաքը", "Выберите город"),
  checkIn: text("Check-in", "Ժամանում", "Заезд"),
  checkOut: text("Check-out", "Մեկնում", "Выезд"),
  adults: text("Adults", "Մեծահասակներ", "Взрослые"),
  rooms: text("Rooms", "Սենյակներ", "Номера"),
  searchButton: text("Search hotels", "Որոնել հյուրանոցներ", "Найти отели"),
  loading: text("Loading destinations…", "Բեռնվում են ուղղությունները…", "Загружаем направления…"),
  unavailable: text("Online search is temporarily unavailable. Please try again shortly.", "Առցանց որոնումը ժամանակավորապես անհասանելի է։ Խնդրում ենք փորձել մի փոքր ուշ։", "Онлайн-поиск временно недоступен. Попробуйте чуть позже."),
  retry: text("Try again", "Կրկին փորձել", "Попробовать снова"),
  empty: text("No hotels match these dates. Try another city or travel dates.", "Այս ամսաթվերի համար հյուրանոցներ չեն գտնվել։ Փորձեք այլ քաղաք կամ ամսաթվեր։", "На эти даты отели не найдены. Попробуйте другой город или даты."),
  loadingHotels: text("Finding your Cyprus stay…", "Որոնում ենք Ձեր հյուրանոցը Կիպրոսում…", "Ищем ваш отель на Кипре…"),
  viewHotel: text("View hotel", "Դիտել հյուրանոցը", "Посмотреть отель"),
  stayTotal: text("Total for your stay", "Կացության ընդհանուր արժեքը", "Итого за проживание"),
  contact: text("Contact MEGATOURS", "Կապվել MEGATOURS-ի հետ", "Связаться с MEGATOURS"),
};

export function getDestination(id: unknown): DestinationConfig | null {
  return destinations.find((destination) => destination.id === id) ?? null;
}

/** Hotel is the base; every chosen extra becomes part of the required package. */
export function requiredServices(selected: readonly DestinationService[]): readonly DestinationService[] {
  return [...new Set<DestinationService>(["hotel", ...selected])];
}

export function destinationFromPath(pathname: string): DestinationId | null {
  const segments = pathname.split("/").filter(Boolean);
  const segment = ["en", "hy", "ru"].includes(segments[0]) ? segments[1] : segments[0];
  if (getDestination(segment)) return segment as DestinationId;
  if (["dubai", "abu-dhabi", "sharjah", "results", "hotels", "services", "checkout"].includes(segment)) return "uae";
  return null;
}

export function destinationHref(locale: Locale, destination: DestinationId, suffix = ""): string {
  return `/${locale}/${destination}${suffix ? `/${suffix.replace(/^\/+/, "")}` : ""}`;
}
