/** New catalogue image hosts can render without opening the server image proxy to arbitrary URLs. */
export function bypassHotelImageOptimization(src: string): boolean {
  if (src.startsWith("/")) return false;
  try { return !["lh3.googleusercontent.com", "static.giinfotech.ae", "api.tbotechnology.in", "photos.hotelbeds.com"].includes(new URL(src).hostname); }
  catch { return true; }
}
