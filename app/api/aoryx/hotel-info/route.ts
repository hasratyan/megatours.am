import { NextRequest, NextResponse } from "next/server";
import { hotelInfo, AoryxServiceError } from "@/lib/aoryx-client";

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

    const info = await hotelInfo(hotelCode);

    return NextResponse.json(info);
  } catch (error) {
    console.error("Hotel info error:", error);

    if (error instanceof AoryxServiceError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: "Failed to load hotel information" },
      { status: 500 }
    );
  }
}
