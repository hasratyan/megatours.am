import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin";
import { getAdminCoupons, upsertCouponAdmin } from "@/lib/coupons";

export const runtime = "nodejs";

const isValidationError = (message: string) =>
  message.toLowerCase().includes("coupon") ||
  message.toLowerCase().includes("discount") ||
  message.toLowerCase().includes("usage limit");

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const isAdmin = isAdminUser({ id: session?.user?.id ?? null, email: session?.user?.email ?? null });
    if (!isAdmin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const coupons = await getAdminCoupons();
    return NextResponse.json({ coupons });
  } catch (error) {
    console.error("[AdminCoupons] Failed to load coupons", error);
    return NextResponse.json({ error: "Failed to load coupons" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const isAdmin = isAdminUser({ id: session?.user?.id ?? null, email: session?.user?.email ?? null });
    if (!isAdmin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as { coupon?: unknown };
    const coupon = await upsertCouponAdmin(body?.coupon ?? null);
    const coupons = await getAdminCoupons();
    return NextResponse.json({ coupon, coupons });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save coupon";
    if (error instanceof Error && isValidationError(message)) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    console.error("[AdminCoupons] Failed to save coupon", error);
    return NextResponse.json({ error: "Failed to save coupon" }, { status: 500 });
  }
}
