import { createHash, randomUUID } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";

const COOKIE = "megatours-destination-session";
export function destinationSearchSession(request: NextRequest) {
  const current = request.cookies.get(COOKIE)?.value;
  const value = current && /^[0-9a-f-]{36}$/.test(current) ? current : randomUUID();
  return { value, ownerId: `visitor:${createHash("sha256").update(value).digest("hex")}`, setCookie: (response: NextResponse) => {
    response.cookies.set(COOKIE, value, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 24 * 60 * 60 });
    return response;
  } };
}
export function isSameOriginMutation(request: NextRequest, env: Record<string, string | undefined> = process.env) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    // TLS terminates at the reverse proxy; compare against configured public origin.
    const publicUrl = env.NODE_ENV === "production" ? env.NEXT_PUBLIC_SITE_URL || env.NEXTAUTH_URL : undefined;
    const expected = publicUrl ? new URL(publicUrl).origin : request.nextUrl.origin;
    return new URL(origin).origin === expected;
  } catch { return false; }
}
