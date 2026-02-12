import { NextRequest, NextResponse } from "next/server";
import { fetchEfesValueSet } from "@/lib/efes-value-set";

export const runtime = "nodejs";

const normalizeEfesList = (payload: unknown): Record<string, unknown>[] => {
  if (Array.isArray(payload)) {
    return payload.filter(
      (item): item is Record<string, unknown> =>
        Boolean(item && typeof item === "object")
    );
  }
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  const nested = record.data;
  if (nested) return normalizeEfesList(nested);
  return [];
};

const readString = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ stateId: string }> }
) {
  void request;
  const { stateId: rawStateId } = await params;
  const stateId = rawStateId?.trim();
  if (!stateId) {
    return NextResponse.json(
      { error: "Missing RA state id." },
      { status: 400 }
    );
  }

  try {
    const payload = await fetchEfesValueSet({ dicName: "dic_country_locations" });
    const cities = normalizeEfesList(payload).filter((item) => {
      const countryId = readString(item.country_id);
      const parentId = readString(item.parent_id);
      const locationId = readString(item.location_id);
      if (countryId !== "1") return false;
      if (!parentId || parentId === "0") return false;
      if (locationId === parentId) return false;
      return parentId === stateId;
    });
    return NextResponse.json(cities);
  } catch (error) {
    console.error("[EFES] Failed to load RA city/villages", error);
    return NextResponse.json(
      { error: "Failed to load RA city/villages." },
      { status: 500 }
    );
  }
}
