import { NextResponse } from "next/server";
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

export async function GET() {
  try {
    const payload = await fetchEfesValueSet({ dicName: "dic_country_locations" });
    const regions = normalizeEfesList(payload).filter((item) => {
      const countryId = readString(item.country_id);
      const parentId = readString(item.parent_id);
      const typeId = readString(item.location_type_id);
      return countryId === "1" && parentId === "0" && typeId === "1";
    });
    return NextResponse.json(regions);
  } catch (error) {
    console.error("[EFES] Failed to load RA states", error);
    return NextResponse.json(
      { error: "Failed to load RA states." },
      { status: 500 }
    );
  }
}
