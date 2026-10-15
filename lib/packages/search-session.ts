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
export function isSameOriginMutation(request: NextRequest) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try { return new URL(origin).origin === request.nextUrl.origin; } catch { return false; }
}
