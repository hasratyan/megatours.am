import { NextRequest, NextResponse, connection } from "next/server";
import { getAmdRates } from "@/lib/pricing";


export async function GET(request: NextRequest) {
  await connection();
  try {
    void request;
    const rates = await getAmdRates();
    return NextResponse.json(rates);
  } catch (error) {
    console.error("[ExchangeRates] Failed to load rates", error);
    return NextResponse.json(
      { error: "Failed to load exchange rates" },
      { status: 500 }
    );
  }
}
