import boundaryData from "./aoryx-area-boundaries.json" with { type: "json" };
import { AORYX_AREAS } from "@/lib/aoryx-areas";
import { getHotelAreaBounds, isHotelInArea, type HotelArea, type HotelAreaGeometry } from "@/lib/hotel-area-geometry";

// Copied from the agent Aoryx map snapshot. Sources and attribution are in
// docs/aoryx-area-boundaries.md; these are polygons, not radius estimates.
const boundaries = boundaryData as unknown as Record<string, HotelAreaGeometry[]>;
const mappedAreas = new Map<string, HotelArea>(AORYX_AREAS.map((area) => {
  const geometries = boundaries[area.id];
  if (!geometries?.length) throw new Error(`Missing mapped boundary for ${area.id}`);
  return [area.id, { ...area, geometries, bounds: getHotelAreaBounds(geometries) }];
}));

export const isHotelInAoryxArea = (
  latitude: number | null | undefined,
  longitude: number | null | undefined,
  areaId: string
): boolean => {
  const area = mappedAreas.get(areaId);
  return Boolean(area && isHotelInArea(latitude, longitude, area));
};
