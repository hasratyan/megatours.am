import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin";
import { extractFlagUpdates, getServiceFlags, saveServiceFlags } from "@/lib/service-flags";
import type { ServiceFlags } from "@/lib/package-builder-state";
import {
  extractPaymentMethodFlagUpdates,
  getPaymentMethodFlags,
  savePaymentMethodFlags,
  type PaymentMethodFlags,
} from "@/lib/payment-method-flags";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const isAdmin = isAdminUser({ id: session?.user?.id ?? null, email: session?.user?.email ?? null });
    if (!isAdmin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [flags, paymentMethods] = await Promise.all([
      getServiceFlags(),
      getPaymentMethodFlags(),
    ]);
    return NextResponse.json({ flags, paymentMethods });
  } catch (error) {
    console.error("[AdminServices] Failed to load admin service settings", error);
    return NextResponse.json({ error: "Failed to load admin service settings" }, { status: 500 });
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
    const updates = extractFlagUpdates(body?.flags ?? null);
    const paymentMethodUpdates = extractPaymentMethodFlagUpdates(body?.paymentMethods ?? null);
    const [currentFlags, currentPaymentMethods] = await Promise.all([
      getServiceFlags(),
      getPaymentMethodFlags(),
    ]);
    const nextFlags = { ...currentFlags, ...updates } as ServiceFlags;
    const nextPaymentMethods = {
      ...currentPaymentMethods,
      ...paymentMethodUpdates,
    } as PaymentMethodFlags;
    const [flags, paymentMethods] = await Promise.all([
      saveServiceFlags(nextFlags),
      savePaymentMethodFlags(nextPaymentMethods),
    ]);
    return NextResponse.json({ flags, paymentMethods });
  } catch (error) {
    console.error("[AdminServices] Failed to save admin service settings", error);
    return NextResponse.json({ error: "Failed to save admin service settings" }, { status: 500 });
  }
}
