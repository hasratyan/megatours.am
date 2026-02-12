import { NextRequest, NextResponse } from "next/server";
import { fetchEfesValueSet } from "@/lib/efes-value-set";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Invalid request body." },
        { status: 400 }
      );
    }
    const payload = body as Record<string, unknown>;
    const dicName = typeof payload.dicName === "string" ? payload.dicName.trim() : "";
    if (!dicName) {
      return NextResponse.json(
        { error: "dicName is required." },
        { status: 400 }
      );
    }
    const data = await fetchEfesValueSet(payload);
    return NextResponse.json(data);
  } catch (error) {
    console.error("[EFES] Failed to load value set", error);
    return NextResponse.json(
      { error: "Failed to load EFES value set." },
      { status: 500 }
    );
  }
}
