import { NextResponse, connection } from "next/server";
import { getPromoPopupConfig } from "@/lib/promo-popup";


export async function GET() {
  await connection();
  try {
    const config = await getPromoPopupConfig();
    return NextResponse.json({ config });
  } catch (error) {
    console.error("[PromoPopup] Failed to load config", error);
    return NextResponse.json({ error: "Failed to load promo popup" }, { status: 500 });
  }
}
