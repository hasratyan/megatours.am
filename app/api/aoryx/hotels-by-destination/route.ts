import { NextRequest, NextResponse } from "next/server";
import { hotelsInfoByDestinationId, normalizeParentDestinationId, AoryxServiceError } from "@/lib/aoryx-client";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));

    const rawDestinationId =
      typeof body.destinationId === "string" && body.destinationId.trim().length > 0
        ? body.destinationId.trim()
        : undefined;
    const parentDestinationId =
      typeof body.parentDestinationId === "string" && body.parentDestinationId.trim().length > 0
        ? body.parentDestinationId.trim()
        : undefined;

    const normalizedParent = normalizeParentDestinationId(parentDestinationId ?? rawDestinationId);

    // Build list of candidate destination IDs to try
    const candidates = Array.from(
      new Set(
        [
          rawDestinationId,
          parentDestinationId,
          normalizedParent && normalizedParent.includes("-") ? normalizedParent : null,
          normalizedParent ? `${normalizedParent}-0` : null,
          normalizedParent ?? null,
        ].filter((value): value is string => typeof value === "string" && value.length > 0)
      )
    );

    if (candidates.length === 0) {
      return NextResponse.json({ error: "destinationId is required" }, { status: 400 });
    }

    let hotels: Awaited<ReturnType<typeof hotelsInfoByDestinationId>> = [];
    let resolvedDestinationId = candidates[0];

    // Try each candidate until we get results
    for (const candidate of candidates) {
      resolvedDestinationId = candidate;
      try {
        hotels = await hotelsInfoByDestinationId(candidate);
        if (Array.isArray(hotels) && hotels.length > 0) break;
      } catch {
        // Continue to next candidate
        continue;
      }
    }

    return NextResponse.json({
      destinationId: resolvedDestinationId,
      hotels,
    });
  } catch (error) {
    console.error("Hotels by destination error:", error);

    if (error instanceof AoryxServiceError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: "Failed to load hotels for destination" },
      { status: 500 }
    );
  }
}
