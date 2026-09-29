export type AoryxAreaCity = "dubai" | "abu-dhabi";

export type AoryxArea = {
  id: string;
  name: string;
  city: AoryxAreaCity;
};

// Keep the search picker lightweight; mapped boundaries load on the server
// and with the map picker, separately from this list.
export const AORYX_AREAS: readonly AoryxArea[] = [
  { id: "dubai-marina", name: "Dubai Marina & JBR", city: "dubai" },
  { id: "palm-jumeirah", name: "Palm Jumeirah", city: "dubai" },
  { id: "downtown-dubai", name: "Downtown Dubai", city: "dubai" },
  { id: "business-bay", name: "Business Bay", city: "dubai" },
  { id: "al-barsha", name: "Al Barsha", city: "dubai" },
  { id: "jvc", name: "Jumeirah Village Circle", city: "dubai" },
  { id: "dubai-creek-harbour", name: "Dubai Creek Harbour", city: "dubai" },
  { id: "saadiyat-island", name: "Saadiyat Island", city: "abu-dhabi" },
  { id: "yas-island", name: "Yas Island", city: "abu-dhabi" },
  { id: "al-reem-island", name: "Al Reem Island", city: "abu-dhabi" },
  { id: "al-maryah-island", name: "Al Maryah Island", city: "abu-dhabi" },
  { id: "khalifa-city", name: "Khalifa City", city: "abu-dhabi" },
];

export const getAoryxAreaCity = (name?: string | null, code?: string | null): AoryxAreaCity | null => {
  const normalized = name?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
  if (normalized === "dubai") return "dubai";
  if (normalized === "abu dhabi" || normalized === "abu-dhabi") return "abu-dhabi";
  if (normalized && !/^\d+(?:-\d+)?$/.test(normalized)) return null;
  if (code === "160" || code === "160-0") return "dubai";
  if (code === "604" || code === "604-0") return "abu-dhabi";
  return null;
};

export const getAoryxAreasForCity = (city: AoryxAreaCity | null): AoryxArea[] =>
  city ? AORYX_AREAS.filter((entry) => entry.city === city) : [];

export const resolveAoryxSearchArea = (
  areaId?: string | null,
  destinationCode?: string | null,
  hotelCode?: string | null
): AoryxArea | undefined => {
  if (hotelCode) return undefined;
  const city = getAoryxAreaCity(null, destinationCode?.trim());
  return AORYX_AREAS.find((entry) => entry.id === areaId && entry.city === city);
};
