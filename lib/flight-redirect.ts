import type { PackageBuilderHotelSelection } from "@/lib/package-builder-state";
import type { AoryxRoomSearch } from "@/types/aoryx";

type FlightProvider = "flydubai" | "airarabia";

type FlightDestination = {
  provider: FlightProvider;
  airlineName: string;
  cityName: string;
  destinationAirportCode: string;
  destinationCodes: string[];
  destinationMatchers: RegExp[];
};

export type AirlinePassengerCounts = {
  adults: number;
  children: number;
  infants: number;
  total: number;
};

export type AirlineFlightRedirect = {
  provider: FlightProvider;
  airlineName: string;
  originAirportCode: "EVN";
  destinationAirportCode: string;
  destinationName: string;
  departureDate: string;
  returnDate: string;
  passengerCounts: AirlinePassengerCounts;
  url: string;
};

const FLIGHT_DESTINATIONS: FlightDestination[] = [
  {
    provider: "flydubai",
    airlineName: "flydubai",
    cityName: "Dubai",
    destinationAirportCode: "DXB",
    destinationCodes: ["160", "160-0", "DXB"],
    destinationMatchers: [/\bdubai\b/i],
  },
  {
    provider: "airarabia",
    airlineName: "Air Arabia",
    cityName: "Sharjah",
    destinationAirportCode: "SHJ",
    destinationCodes: ["605", "605-0", "SHJ"],
    destinationMatchers: [/\bsharjah\b/i],
  },
  {
    provider: "airarabia",
    airlineName: "Air Arabia",
    cityName: "Abu Dhabi",
    destinationAirportCode: "UAE",
    destinationCodes: ["604", "604-0", "AUH", "UAE"],
    destinationMatchers: [/\babu\s*dhabi\b/i, /\babudhabi\b/i],
  },
];

const normalizeDestinationCode = (value: string | null | undefined) =>
  value?.trim().toUpperCase() ?? "";

const normalizeDestinationName = (value: string | null | undefined) =>
  value?.trim().replace(/[-_]+/g, " ") ?? "";

const isIsoDate = (value: string | null | undefined): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim());

const formatFlydubaiDate = (value: string) => value.replaceAll("-", "");

const formatAirArabiaDate = (value: string) => {
  const [year, month, day] = value.split("-");
  return `${day}-${month}-${year}`;
};

const resolveFlightDestination = (
  destinationName: string | null | undefined,
  destinationCode: string | null | undefined
) => {
  const normalizedCode = normalizeDestinationCode(destinationCode);
  const normalizedName = normalizeDestinationName(destinationName);

  const byCode = FLIGHT_DESTINATIONS.find((destination) =>
    destination.destinationCodes.includes(normalizedCode)
  );
  if (byCode) return byCode;

  return FLIGHT_DESTINATIONS.find((destination) =>
    destination.destinationMatchers.some((matcher) => matcher.test(normalizedName))
  ) ?? null;
};

export const resolveAirlinePassengerCounts = (
  rooms: AoryxRoomSearch[] | null | undefined,
  fallbackGuestCount: number | null | undefined
): AirlinePassengerCounts => {
  if (!Array.isArray(rooms) || rooms.length === 0) {
    const adults =
      typeof fallbackGuestCount === "number" && Number.isFinite(fallbackGuestCount)
        ? Math.max(1, Math.floor(fallbackGuestCount))
        : 1;
    return { adults, children: 0, infants: 0, total: adults };
  }

  let adults = 0;
  let children = 0;
  let infants = 0;

  rooms.forEach((room) => {
    adults +=
      typeof room.adults === "number" && Number.isFinite(room.adults)
        ? Math.max(0, Math.floor(room.adults))
        : 0;

    const childAges = Array.isArray(room.childrenAges) ? room.childrenAges : [];
    childAges.forEach((age) => {
      if (typeof age !== "number" || !Number.isFinite(age)) {
        children += 1;
        return;
      }
      if (age < 2) {
        infants += 1;
        return;
      }
      if (age >= 12) {
        adults += 1;
        return;
      }
      children += 1;
    });
  });

  const safeAdults = Math.max(1, adults);
  return {
    adults: safeAdults,
    children,
    infants,
    total: safeAdults + children + infants,
  };
};

const buildFlydubaiUrl = (
  destinationAirportCode: string,
  departureDate: string,
  returnDate: string,
  passengerCounts: AirlinePassengerCounts
) => {
  const pax = `a${passengerCounts.adults}c${passengerCounts.children}i${passengerCounts.infants}`;
  const route = `EVN_${destinationAirportCode}`;
  const dates = `${formatFlydubaiDate(departureDate)}_${formatFlydubaiDate(returnDate)}`;
  return `https://flights2.flydubai.com/en/results/rt/${pax}/${route}/${dates}?cabinClass=Economy&isOriginMetro=false&isDestMetro=false&pm=cash`;
};

const buildAirArabiaUrl = (
  destinationAirportCode: string,
  departureDate: string,
  returnDate: string,
  passengerCounts: AirlinePassengerCounts
) => {
  const parts = [
    "AMD",
    "AM",
    "EVN",
    destinationAirportCode,
    formatAirArabiaDate(departureDate),
    formatAirArabiaDate(returnDate),
    passengerCounts.adults.toString(),
    passengerCounts.children.toString(),
    passengerCounts.infants.toString(),
    "Y",
    "N",
    "Y",
  ];
  return `https://www.airarabia.com/en/booking/select-flight#/fare/${parts.join("/")}`;
};

export const buildFlightRedirectFromHotel = (
  hotel: PackageBuilderHotelSelection | null | undefined
): AirlineFlightRedirect | null => {
  if (!hotel?.selected) return null;
  const departureDate = hotel.checkInDate?.trim() ?? "";
  const returnDate = hotel.checkOutDate?.trim() ?? "";
  if (!isIsoDate(departureDate) || !isIsoDate(returnDate)) return null;

  const destination = resolveFlightDestination(hotel.destinationName, hotel.destinationCode);
  if (!destination) return null;

  const passengerCounts = resolveAirlinePassengerCounts(hotel.rooms, hotel.guestCount);
  const url =
    destination.provider === "flydubai"
      ? buildFlydubaiUrl(
          destination.destinationAirportCode,
          departureDate,
          returnDate,
          passengerCounts
        )
      : buildAirArabiaUrl(
          destination.destinationAirportCode,
          departureDate,
          returnDate,
          passengerCounts
        );

  return {
    provider: destination.provider,
    airlineName: destination.airlineName,
    originAirportCode: "EVN",
    destinationAirportCode: destination.destinationAirportCode,
    destinationName: destination.cityName,
    departureDate,
    returnDate,
    passengerCounts,
    url,
  };
};
