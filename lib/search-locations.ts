import { getAoryxAreaCity, getAoryxAreasForCity } from "@/lib/aoryx-areas";

export type SearchLocationOption = {
  value: string;
  label: string;
  rawId?: string;
  type: "destination" | "area" | "hotel";
  areaId?: string;
  areaName?: string;
  parentDestinationId?: string;
  parentDestinationLabel?: string;
  lat?: number;
  lng?: number;
  rating?: number;
  imageUrl?: string;
  price?: string;
};

export const getAreaLocationOptions = (destination: SearchLocationOption): SearchLocationOption[] => {
  const city = getAoryxAreaCity(destination.label, destination.rawId ?? destination.value);
  const cityName = city === "dubai" ? "Dubai" : "Abu Dhabi";
  return getAoryxAreasForCity(city).map((area) => ({
    value: `area:${area.id}`,
    label: `${area.name}, ${cityName}`,
    type: "area",
    areaId: area.id,
    areaName: area.name,
    parentDestinationId: destination.rawId ?? destination.value,
    parentDestinationLabel: cityName,
  }));
};
