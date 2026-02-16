import type { Locale } from "@/lib/i18n";

export type LocalizedText = Record<Locale, string>;

type DestinationGalleryItem = {
  src: string;
  alt: LocalizedText;
};

type DestinationHighlight = {
  title: LocalizedText;
  description: LocalizedText;
};

type DestinationFact = {
  label: LocalizedText;
  value: LocalizedText;
};

type DestinationHotel = {
  name: string;
  area: LocalizedText;
  description: LocalizedText;
  image: string;
  rating: number;
  priceFrom: number;
};

export type DestinationData = {
  slug: string;
  name: LocalizedText;
  country: LocalizedText;
  heroTag: LocalizedText;
  heroTitle: LocalizedText;
  heroSummary: LocalizedText;
  storyTitle: LocalizedText;
  storyBody: LocalizedText;
  heroImage: string;
  heroVideo: string;
  gallery: DestinationGalleryItem[];
  highlights: DestinationHighlight[];
  facts: DestinationFact[];
  hotelsTitle: LocalizedText;
  hotelsSubtitle: LocalizedText;
  hotels: DestinationHotel[];
  ctaTitle: LocalizedText;
  ctaBody: LocalizedText;
  ctaLabel: LocalizedText;
};

const t = (hy: string, en: string, ru: string): LocalizedText => ({ hy, en, ru });

const defaultGallery: DestinationGalleryItem[] = [
  {
    src: "/images/burj-khalifa.webp",
    alt: t("Բուրջ Խալիֆա", "Burj Khalifa skyline", "Небоскреб Бурдж-Халифа"),
  },
  {
    src: "/images/safari.webp",
    alt: t("Անապատային սաֆարի", "Desert safari", "Пустынное сафари"),
  },
  {
    src: "/images/cruise.webp",
    alt: t("Երեկոյան նավարկություն", "Evening marina cruise", "Вечерний круиз"),
  },
  {
    src: "/images/helicopter.webp",
    alt: t("Ուղղաթիռային թռիչք", "Helicopter city view", "Вертолетный обзор"),
  },
  {
    src: "/images/yas-island.webp",
    alt: t("Յաս կղզու ոճ", "Yas-style waterfront", "Набережная в стиле Yas"),
  },
  {
    src: "/images/all-attractions.webp",
    alt: t("Տեսարժան վայրեր", "City attractions", "Городские достопримечательности"),
  },
];

const defaultHighlights: DestinationHighlight[] = [
  {
    title: t("Քաղաք + ծովափ", "City + beach", "Город + пляж"),
    description: t(
      "Ժամանակակից skyline, բարձրակարգ լողափեր և աշխույժ ափամերձ կյանք։",
      "Modern skyline, luxury beaches, and vibrant waterfront life.",
      "Современный skyline, премиальные пляжи и активная набережная жизнь."
    ),
  },
  {
    title: t("Ընտանեկան ժամանց", "Family-friendly", "Для всей семьи"),
    description: t(
      "Թեմատիկ պարկերից մինչև waterpark-եր, երեխաների և մեծահասակների համար։",
      "Theme parks to waterparks, designed for all ages.",
      "От тематических парков до аквапарков для всех возрастов."
    ),
  },
  {
    title: t("Luxury shopping", "Luxury shopping", "Luxury shopping"),
    description: t(
      "Մոլեր, designer boutiques և գաստրոնոմիական փորձառություններ մեկ վայրում։",
      "World-class malls, designer boutiques, and dining experiences in one place.",
      "Мировые моллы, дизайнерские бутики и гастрономия в одном месте."
    ),
  },
];

const defaultHotels: DestinationHotel[] = [
  {
    name: "Atlantis The Palm",
    area: t("Պալմ Ջումեյրա", "Palm Jumeirah", "Палм-Джумейра"),
    description: t(
      "Iconic հանգիստ ջրաշխարհով և մեծ ընտանեկան ենթակառուցվածքով։",
      "Iconic beachfront resort with waterpark access and family amenities.",
      "Легендарный курорт у моря с аквапарком и семейной инфраструктурой."
    ),
    image: "/images/yas-island.webp",
    rating: 5,
    priceFrom: 420,
  },
  {
    name: "Address Sky View",
    area: t("Դաունթաուն", "Downtown", "Даунтаун"),
    description: t(
      "Քաղաքի սրտում panoramic տեսարաններով և բարձրակարգ սպասարկմամբ։",
      "Urban luxury stay with panoramic skyline views.",
      "Городской luxury-отель с панорамным видом на skyline."
    ),
    image: "/images/burj-khalifa.webp",
    rating: 5,
    priceFrom: 330,
  },
  {
    name: "Jumeirah Beach Hotel",
    area: t("Ջումեյրա", "Jumeirah", "Джумейра"),
    description: t(
      "Ծովափնյա premium ընտրություն ընտանիքների և զույգերի համար։",
      "Premium beachfront pick for couples and families.",
      "Премиальный выбор на берегу для пар и семей."
    ),
    image: "/images/all-attractions.webp",
    rating: 5,
    priceFrom: 290,
  },
  {
    name: "Vida Marina",
    area: t("Դուբայ Մարինա", "Dubai Marina", "Дубай Марина"),
    description: t(
      "Ժամանակակից ինտերիեր, walkable district և երեկոյան աշխույժ մթնոլորտ։",
      "Contemporary design in a walkable, lively marina district.",
      "Современный дизайн в оживленном районе Marina."
    ),
    image: "/images/cruise.webp",
    rating: 4,
    priceFrom: 210,
  },
  {
    name: "Rixos Premium",
    area: t("JBR", "JBR", "JBR"),
    description: t(
      "Ծովափ, nightlife և բարձրակարգ դինամիկ հանգիստ մեկ հասցեում։",
      "Beach, nightlife, and high-energy premium stay in one address.",
      "Пляж, nightlife и динамичный премиальный отдых в одном месте."
    ),
    image: "/images/car.webp",
    rating: 5,
    priceFrom: 275,
  },
  {
    name: "The Lana, Dorchester Collection",
    area: t("Բիզնես Բեյ", "Business Bay", "Бизнес-Бэй"),
    description: t(
      "Նոր սերնդի luxury հյուրանոց բացառիկ ճարտարապետությամբ։",
      "Next-generation luxury hotel with standout architecture.",
      "Luxury-отель нового поколения с эффектной архитектурой."
    ),
    image: "/images/helicopter.webp",
    rating: 5,
    priceFrom: 510,
  },
];

const bySlug: Record<string, DestinationData> = {
  dubai: {
    slug: "dubai",
    name: t("Դուբայ", "Dubai", "Дубай"),
    country: t("ԱՄԷ", "UAE", "ОАЭ"),
    heroTag: t("Premium City Break", "Premium City Break", "Premium City Break"),
    heroTitle: t(
      "Դուբայ, որտեղ luxury-ն հանդիպում է արկածին",
      "Dubai, where luxury meets adventure",
      "Дубай, где luxury встречает приключение"
    ),
    heroSummary: t(
      "Մշակված է ճանապարհորդների համար, ովքեր ուզում են մեկ ուղևորության մեջ ունենալ հանգիստ, ժամանց և բարձրակարգ սպասարկում։",
      "Curated for travelers who want relaxation, entertainment, and premium service in one trip.",
      "Создано для путешественников, которым нужны отдых, развлечения и премиальный сервис в одной поездке."
    ),
    storyTitle: t("Դուբայի կարճ պատմությունը", "A short story of Dubai", "Короткая история Дубая"),
    storyBody: t(
      "Մի փոքր ձկնորսական բնակավայրից Դուբայը դարձավ գլոբալ քաղաք, որտեղ ավանդույթն ու ֆուտուրիստական ճարտարապետությունը համատեղվում են բնական ձևով։ Այսօր այն ընտրված ուղղություն է թե՛ ընտանեկան, թե՛ luxury ուղևորությունների համար։",
      "From a small trading port to a global destination, Dubai blends heritage with futuristic architecture in a way few cities can. Today, it is a top choice for both family holidays and luxury escapes.",
      "Из небольшого торгового порта Дубай превратился в глобальный центр, где традиции и футуристическая архитектура сочетаются естественно. Сегодня это один из лучших выборов для семейных и luxury-поездок."
    ),
    heroImage: "/images/burj-khalifa.webp",
    heroVideo: "/videos/dubai.mp4",
    gallery: defaultGallery,
    highlights: defaultHighlights,
    facts: [
      { label: t("Լավագույն սեզոն", "Best season", "Лучший сезон"), value: t("Նոյեմբեր - Ապրիլ", "November - April", "Ноябрь - Апрель") },
      { label: t("Թռիչք Երևանից", "Flight from Yerevan", "Перелет из Еревана"), value: t("~3.5 ժամ", "~3.5 hours", "~3.5 часа") },
      { label: t("Իդեալական տևողություն", "Ideal duration", "Идеальная длительность"), value: t("5-7 օր", "5-7 days", "5-7 дней") },
      { label: t("Ժամային գոտի", "Time zone", "Часовой пояс"), value: t("GMT+4", "GMT+4", "GMT+4") },
    ],
    hotelsTitle: t("Թոփ 6 հյուրանոց", "Top 6 hotels", "Топ 6 отелей"),
    hotelsSubtitle: t(
      "Ընտրված premium տարբերակներ տարբեր բյուջեների համար",
      "Curated premium stays across different budgets",
      "Подборка премиальных вариантов под разные бюджеты"
    ),
    hotels: defaultHotels,
    ctaTitle: t("Կազմենք Ձեր Դուբայի փաթեթը", "Let us build your Dubai package", "Соберем ваш пакет в Дубай"),
    ctaBody: t(
      "Հյուրանոց, թռիչք, transfer և ժամանց մեկ խելացի փաթեթում։",
      "Hotel, flights, transfers, and experiences in one smart package.",
      "Отель, перелет, трансфер и активности в одном удобном пакете."
    ),
    ctaLabel: t("Սկսել հիմա", "Start planning", "Начать планирование"),
  },
  "abu-dhabi": {
    slug: "abu-dhabi",
    name: t("Աբու Դաբի", "Abu Dhabi", "Абу-Даби"),
    country: t("ԱՄԷ", "UAE", "ОАЭ"),
    heroTag: t("Culture & Luxury", "Culture & Luxury", "Culture & Luxury"),
    heroTitle: t(
      "Աբու Դաբի. էլեգանտ հանգիստ և մշակութային խորություն",
      "Abu Dhabi for elegant stays and cultural depth",
      "Абу-Даби для элегантного отдыха и культурной глубины"
    ),
    heroSummary: t(
      "Մայրաքաղաքային հանգիստ, թանգարաններ, պրեմիում ռեզորթներ և ընտանեկան այգիներ։",
      "Capital-city calm with museums, premium resorts, and family attractions.",
      "Столичный ритм с музеями, премиальными курортами и семейными парками."
    ),
    storyTitle: t("Աբու Դաբիի կարճ պատմություն", "A short story of Abu Dhabi", "Короткая история Абу-Даби"),
    storyBody: t(
      "Աբու Դաբին ձևավորվել է որպես վարչական և մշակութային կենտրոն, որտեղ ավանդական արաբական ինքնությունն ուժեղ է, իսկ ժամանակակից զարգացումը` հավասարակշռված։",
      "Abu Dhabi developed as the UAE's administrative and cultural heart, combining strong heritage with refined modern growth.",
      "Абу-Даби сформировался как административный и культурный центр ОАЭ, сочетая наследие и продуманное современное развитие."
    ),
    heroImage: "/images/yas-island.webp",
    heroVideo: "/videos/uae.mp4",
    gallery: defaultGallery,
    highlights: defaultHighlights,
    facts: [
      { label: t("Լավագույն սեզոն", "Best season", "Лучший сезон"), value: t("Նոյեմբեր - Ապրիլ", "November - April", "Ноябрь - Апрель") },
      { label: t("Թռիչք Երևանից", "Flight from Yerevan", "Перелет из Еревана"), value: t("~3.5 ժամ", "~3.5 hours", "~3.5 часа") },
      { label: t("Իդեալական տևողություն", "Ideal duration", "Идеальная длительность"), value: t("4-6 օր", "4-6 days", "4-6 дней") },
      { label: t("Ժամային գոտի", "Time zone", "Часовой пояс"), value: t("GMT+4", "GMT+4", "GMT+4") },
    ],
    hotelsTitle: t("Թոփ 6 հյուրանոց", "Top 6 hotels", "Топ 6 отелей"),
    hotelsSubtitle: t(
      "Կայուն բարձր որակ և հանգիստ մթնոլորտ",
      "Consistently high quality with a calm atmosphere",
      "Стабильно высокий уровень и спокойная атмосфера"
    ),
    hotels: defaultHotels,
    ctaTitle: t("Կազմենք Ձեր Աբու Դաբի ուղևորությունը", "Plan your Abu Dhabi journey", "Спланируем вашу поездку в Абу-Даби"),
    ctaBody: t(
      "Մշակութային այցելություններ, ընտանեկան ժամանց և premium տեղավորում։",
      "Cultural visits, family entertainment, and premium stays.",
      "Культурные визиты, семейные развлечения и премиальное размещение."
    ),
    ctaLabel: t("Ստանալ առաջարկ", "Get proposal", "Получить предложение"),
  },
  sharjah: {
    slug: "sharjah",
    name: t("Շարժա", "Sharjah", "Шарджа"),
    country: t("ԱՄԷ", "UAE", "ОАЭ"),
    heroTag: t("Authentic & Family", "Authentic & Family", "Authentic & Family"),
    heroTitle: t(
      "Շարժա. մշակույթ, հանգիստ և ընտանեկան ուղևորություն",
      "Sharjah for culture, calm beaches, and family travel",
      "Шарджа для культуры, спокойных пляжей и семейного отдыха"
    ),
    heroSummary: t(
      "Հարմար է նրանց համար, ովքեր նախընտրում են ավելի հանգիստ տեմպ և արժեք/որակ հավասարակշռություն։",
      "Ideal for travelers seeking a calmer rhythm and strong value-for-quality.",
      "Идеально для тех, кто ищет спокойный ритм и выгодный баланс цены и качества."
    ),
    storyTitle: t("Շարժայի կարճ պատմություն", "A short story of Sharjah", "Короткая история Шарджи"),
    storyBody: t(
      "Շարժան երկար տարիներ ճանաչվել է որպես ԱՄԷ-ի մշակութային կենտրոն։ Թանգարանները, ավանդական շուկաները և ծովափնյա գոտին ստեղծում են հավասարակշռված հանգստի փորձառություն։",
      "Known as the UAE's cultural capital, Sharjah offers museums, heritage souks, and relaxed waterfront living.",
      "Шарджа известна как культурная столица ОАЭ: музеи, исторические рынки и спокойная набережная создают сбалансированный отдых."
    ),
    heroImage: "/images/all-attractions.webp",
    heroVideo: "/videos/uae.mp4",
    gallery: defaultGallery,
    highlights: defaultHighlights,
    facts: [
      { label: t("Լավագույն սեզոն", "Best season", "Лучший сезон"), value: t("Նոյեմբեր - Մարտ", "November - March", "Ноябрь - Март") },
      { label: t("Թռիչք Երևանից", "Flight from Yerevan", "Перелет из Еревана"), value: t("~3.5 ժամ", "~3.5 hours", "~3.5 часа") },
      { label: t("Իդեալական տևողություն", "Ideal duration", "Идеальная длительность"), value: t("4-7 օր", "4-7 days", "4-7 дней") },
      { label: t("Ժամային գոտի", "Time zone", "Часовой пояс"), value: t("GMT+4", "GMT+4", "GMT+4") },
    ],
    hotelsTitle: t("Թոփ 6 հյուրանոց", "Top 6 hotels", "Топ 6 отелей"),
    hotelsSubtitle: t(
      "Ընտանեկան և հանգիստ հանգստի համար լավագույն տարբերակները",
      "Great options for family-friendly and calm stays",
      "Лучшие варианты для семейного и спокойного отдыха"
    ),
    hotels: defaultHotels,
    ctaTitle: t("Պլանավորենք Ձեր Շարժայի փաթեթը", "Let us craft your Sharjah package", "Соберем ваш пакет в Шарджу"),
    ctaBody: t(
      "Ավելի հանգիստ ռիթմ, որակյալ հյուրանոցներ և ընտրված էքսկուրսիաներ։",
      "A calmer pace, quality hotels, and carefully selected experiences.",
      "Спокойный ритм, качественные отели и тщательно подобранные активности."
    ),
    ctaLabel: t("Կապ հաստատել", "Contact us", "Связаться"),
  },
};

export const destinationSlugs = Object.keys(bySlug);

export function getDestinationData(slug: string): DestinationData | null {
  return bySlug[slug] ?? null;
}
