import type { AoryxHotelInfoResult } from "@/types/aoryx";

/** Keep large media/amenity lists out of the hotel summary's prefetch payload. */
export function getHotelPrefetchSummary(hotel: AoryxHotelInfoResult): AoryxHotelInfoResult {
  const firstImage = hotel.imageUrls.find((image) => image.trim().length > 0);
  return { ...hotel, imageUrls: firstImage ? [firstImage] : [], masterHotelAmenities: null };
}

/** Prefer full-size versions of duplicate supplier photos, retaining their order. */
export function getHotelGalleryImages(images: readonly string[]): string[] {
  const unique = new Map<string, { url: string; score: number }>();
  for (const image of images) {
    const url = image.trim();
    if (!url) continue;
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(url).pathname);
    } catch {
      pathname = url.replace(/[?#].*$/g, "");
    }
    const key = pathname.replace(/\/(thumbnail|full)\//gi, "/").replace(/\/+$/g, "").toLowerCase();
    const score = /\/full\//i.test(pathname) ? 2 : /\/thumbnail\//i.test(pathname) ? 1 : 0;
    const existing = unique.get(key);
    if (!existing || score > existing.score) unique.set(key, { url, score });
  }
  return Array.from(unique.values(), ({ url }) => url);
}
