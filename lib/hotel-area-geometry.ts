import type { MultiPolygon, Polygon, Position } from "geojson";

export type HotelAreaGeometry = Polygon | MultiPolygon;

export type HotelArea = {
  id: string;
  name: string;
  geometries: HotelAreaGeometry[];
  bounds: [south: number, west: number, north: number, east: number];
};

export const getHotelAreaBounds = (geometries: HotelAreaGeometry[]): HotelArea["bounds"] => {
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const geometry of geometries) {
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    for (const polygon of polygons) {
      for (const ring of polygon) {
        for (const [longitude, latitude] of ring) {
          south = Math.min(south, latitude);
          west = Math.min(west, longitude);
          north = Math.max(north, latitude);
          east = Math.max(east, longitude);
        }
      }
    }
  }
  return [south, west, north, east];
};

const pointOnSegment = (longitude: number, latitude: number, start: Position, end: Position): boolean => {
  const cross = (longitude - start[0]) * (end[1] - start[1]) -
    (latitude - start[1]) * (end[0] - start[0]);
  return Math.abs(cross) <= 1e-10 &&
    longitude >= Math.min(start[0], end[0]) - 1e-9 &&
    longitude <= Math.max(start[0], end[0]) + 1e-9 &&
    latitude >= Math.min(start[1], end[1]) - 1e-9 &&
    latitude <= Math.max(start[1], end[1]) + 1e-9;
};

const pointInRing = (longitude: number, latitude: number, ring: Position[]): boolean => {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const start = ring[previous];
    const end = ring[index];
    if (pointOnSegment(longitude, latitude, start, end)) return true;
    if ((start[1] > latitude) !== (end[1] > latitude) &&
      longitude < ((end[0] - start[0]) * (latitude - start[1])) / (end[1] - start[1]) + start[0]) {
      inside = !inside;
    }
  }
  return inside;
};

const pointInPolygon = (longitude: number, latitude: number, rings: Position[][]): boolean =>
  rings.length > 0 && pointInRing(longitude, latitude, rings[0]) &&
  !rings.slice(1).some((hole) => pointInRing(longitude, latitude, hole));

export const isHotelInArea = (
  latitude: number | null | undefined,
  longitude: number | null | undefined,
  entry: HotelArea
): boolean => {
  if (typeof latitude !== "number" || !Number.isFinite(latitude) ||
    typeof longitude !== "number" || !Number.isFinite(longitude)) return false;

  const [south, west, north, east] = entry.bounds;
  if (latitude < south || latitude > north || longitude < west || longitude > east) return false;

  return entry.geometries.some((geometry) => {
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    return polygons.some((polygon) => pointInPolygon(longitude, latitude, polygon));
  });
};

export const isHotelInAnyArea = (
  latitude: number | null | undefined,
  longitude: number | null | undefined,
  areas: readonly HotelArea[]
): boolean => areas.some((entry) => isHotelInArea(latitude, longitude, entry));
