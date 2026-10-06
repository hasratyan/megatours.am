import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { getHotelInfoFromDb } from "@/lib/hotel-info-db";

/** Public hotel content only. Supplier rates and booking state stay request-time. */
export async function getHotelContent(hotelCode: string) {
  "use cache";
  cacheLife({ stale: 300, revalidate: 3600, expire: 86400 });
  cacheTag("aoryx-hotel-content", `aoryx-hotel-${hotelCode}`);
  const content = await getHotelInfoFromDb(hotelCode);
  if (!content) cacheLife({ stale: 0, revalidate: 60, expire: 120 });
  return content;
}
