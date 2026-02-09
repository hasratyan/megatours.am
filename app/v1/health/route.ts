import { NextResponse } from "next/server";
import { isAoryxConfigured, isEfesConfigured } from "@/lib/env";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "megatours-b2b-gateway",
    timestamp: new Date().toISOString(),
    suppliers: {
      aoryx: isAoryxConfigured(),
      efes: isEfesConfigured(),
    },
  });
}

