import { NextRequest, NextResponse } from "next/server";
import { getHotelInfoFromDb } from "@/lib/hotel-info-db";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const hotelCode =
      typeof body.hotelCode === "string" && body.hotelCode.trim().length > 0
        ? body.hotelCode.trim()
        : undefined;

    if (!hotelCode) {
      return NextResponse.json({ error: "hotelCode is required" }, { status: 400 });
    }

    const info = await getHotelInfoFromDb(hotelCode);

    return NextResponse.json(info);
  } catch (error) {
    console.error("Hotel info error:", error);

    return NextResponse.json(
      { error: "Failed to load hotel information" },
      { status: 500 }
    );
  }
}
