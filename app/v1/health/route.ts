import { NextResponse, connection } from "next/server";
import { isAoryxConfigured, isEfesConfigured } from "@/lib/env";


export async function GET() {
  await connection();
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

