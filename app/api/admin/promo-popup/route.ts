import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin";
import { getPromoPopupAdminConfig, savePromoPopupConfig } from "@/lib/promo-popup";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const isAdmin = isAdminUser({ id: session?.user?.id ?? null, email: session?.user?.email ?? null });
    if (!isAdmin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const config = await getPromoPopupAdminConfig();
    return NextResponse.json({ config });
  } catch (error) {
    console.error("[AdminPromoPopup] Failed to load config", error);
    return NextResponse.json({ error: "Failed to load promo popup" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const isAdmin = isAdminUser({ id: session?.user?.id ?? null, email: session?.user?.email ?? null });
    if (!isAdmin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const config = await savePromoPopupConfig(body?.config ?? null);
    return NextResponse.json({ config });
  } catch (error) {
    console.error("[AdminPromoPopup] Failed to save config", error);
    return NextResponse.json({ error: "Failed to save promo popup" }, { status: 500 });
  }
}
