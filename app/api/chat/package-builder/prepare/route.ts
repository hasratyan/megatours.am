import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth-compat/server";
import { authOptions } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getServiceFlags } from "@/lib/service-flags";
import { consumeAssistantRateLimit } from "@/lib/package-assistant-rate-limit";
import { isAllowedUaeDestinationCode } from "@/lib/package-assistant";
import { roomDetails, preBook } from "@/lib/aoryx-client";
import { withAoryxDefaults } from "@/lib/aoryx-search";
import { getAoryxHotelPlatformFee } from "@/lib/pricing";
import { applyMarkup } from "@/lib/pricing-utils";
import { setPrebookCookie } from "@/app/api/aoryx/_shared";
import { hashRateKey, obfuscateRoomOptions } from "@/lib/aoryx-rate-tokens";
import { selectBookableRoomGroup } from "@/lib/package-assistant-room-group";
import type { AoryxRoomSearch } from "@/types/aoryx";
import type { PackageAssistantPackageOption } from "@/types/package-assistant";
import type { PackageBuilderHotelSelection } from "@/lib/package-builder-state";

export const runtime = "nodejs";

const validDate = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

export async function POST(request: NextRequest) {
  try {
    const flags = await getServiceFlags();
    if (!flags.aiChat || !flags.hotel) {
      return NextResponse.json({ error: "AI hotel selection is unavailable." }, { status: 403 });
    }
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
    const optionId = typeof body?.optionId === "string" ? body.optionId : "";
    if (!sessionId || !optionId) {
      return NextResponse.json({ error: "Missing package option." }, { status: 400 });
    }
    const auth = await getServerSession(authOptions);
    const userId = auth?.user?.id ?? auth?.user?.email ?? null;
    const guestOwner = request.cookies.get("package_assistant_owner")?.value;
    if (!userId && !guestOwner) {
      return NextResponse.json({ error: "Chat session expired. Please try again." }, { status: 403 });
    }
    const ownerKey = userId ? `user:${userId}` : `guest:${guestOwner}`;
    const rateLimit = await consumeAssistantRateLimit(ownerKey, "prepare");
    if (!rateLimit.allowed) {
      return NextResponse.json({ error: "Too many hotel checks. Please try again later." }, {
        status: 429, headers: { "Retry-After": String(rateLimit.retryAfter) },
      });
    }
    const db = await getDb();
    const session = await db.collection<{ _id: string; ownerKey: string; context?: unknown }>("package_assistant_sessions").findOne({
      _id: sessionId, ownerKey,
    });
    if (!session) {
      return NextResponse.json({ error: "Package suggestion is no longer available." }, { status: 404 });
    }
    const saved = await db.collection("package_assistant_messages").findOne(
      { sessionId, role: "assistant", "packageOptions.id": optionId },
      { sort: { createdAt: -1 }, projection: { packageOptions: 1 } }
    );
    const option = (saved?.packageOptions as PackageAssistantPackageOption[] | undefined)
      ?.find((entry) => entry.id === optionId);
    const hotel = option?.draft.hotel;
    const hotelCode = hotel?.hotelCode?.trim();
    const destinationCode = hotel?.destinationCode?.trim();
    if (!hotel?.selected || !hotelCode || !destinationCode ||
        !validDate(hotel.checkInDate) || !validDate(hotel.checkOutDate) ||
        hotel.checkOutDate <= hotel.checkInDate ||
        hotel.checkInDate < new Date().toISOString().slice(0, 10)) {
      return NextResponse.json({ error: "Choose a hotel with valid travel dates first." }, { status: 400 });
    }
    if (!(await isAllowedUaeDestinationCode(destinationCode))) {
      return NextResponse.json({ error: "Only UAE hotels are supported." }, { status: 400 });
    }
    const roomCount = Number(hotel.roomCount ?? 1);
    const guestCount = Number(hotel.guestCount ?? 0);
    const savedContext = session.context as { children?: number; childAges?: number[] } | null;
    const childAges = hotel.childAges ?? savedContext?.childAges ?? [];
    const childCount = Number(hotel.children ?? savedContext?.children ?? childAges.length);
    if (!Number.isInteger(roomCount) || roomCount < 1 || roomCount > 4 ||
        !Number.isInteger(guestCount) || guestCount < roomCount || guestCount > 20 ||
        !Number.isInteger(childCount) || childCount < 0 || childCount > 8 ||
        childAges.length !== childCount ||
        childAges.some((age) => !Number.isInteger(age) || age < 0 || age > 17) ||
        guestCount - childCount < roomCount) {
      return NextResponse.json({
        error: "Please confirm the number of rooms, travelers and each child's age in chat first.",
      }, { status: 400 });
    }
    const adults = guestCount - childCount;
    const rooms: AoryxRoomSearch[] = Array.from({ length: roomCount }, (_, index) => ({
      roomIdentifier: index + 1,
      adults: Math.floor(adults / roomCount) + (index < adults % roomCount ? 1 : 0),
      childrenAges: childAges.filter((_, childIndex) => childIndex % roomCount === index),
    }));
    const currency = hotel.currency ?? "USD";
    const details = await roomDetails(withAoryxDefaults({
      hotelCode, destinationCode, countryCode: "AE", nationality: "AM",
      checkInDate: hotel.checkInDate, checkOutDate: hotel.checkOutDate,
      currency, rooms,
    }));
    const group = selectBookableRoomGroup(details.rooms, roomCount);
    if (!group) {
      return NextResponse.json({ error: "No bookable room is available for these travelers. Please choose another hotel." }, { status: 409 });
    }
    const rateKeys = group.rooms.map((room) => room.rateKey!);
    const prebook = await preBook(details.sessionId, hotelCode, group.groupCode, rateKeys, details.currency ?? currency);
    if (prebook.isBookable !== true || prebook.isSoldOut === true || prebook.isPriceChanged === true) {
      return NextResponse.json({ error: "The hotel rate changed or sold out. Please ask for fresh options." }, { status: 409 });
    }
    const fee = await getAoryxHotelPlatformFee().catch((error) => {
      console.error("[PackageAssistant] Could not load hotel markup", error);
      return null;
    });
    const basePrice = group.rooms.reduce((sum, room) => sum + (room.totalPrice ?? 0), 0);
    const publicRooms = obfuscateRoomOptions(group.rooms, { sessionId: details.sessionId, hotelCode });
    const hotelSelection: PackageBuilderHotelSelection = {
      selected: true, hotelCode, hotelName: hotel.hotelName ?? null,
      destinationCode, destinationName: hotel.destinationName ?? null,
      countryCode: "AE", nationality: "AM",
      checkInDate: hotel.checkInDate, checkOutDate: hotel.checkOutDate,
      roomCount, guestCount, rooms,
      mealPlan: group.rooms[0]?.meal ?? group.rooms[0]?.boardType ?? null,
      nonRefundable: group.rooms.every((room) => room.refundable === false),
      roomSelections: publicRooms.map((room) => ({
        roomIdentifier: room.roomIdentifier ?? 1, rateKey: room.rateKey!,
        price: { gross: room.price?.gross ?? room.totalPrice, net: room.price?.net ?? room.totalPrice,
          tax: room.price?.tax ?? 0 },
      })),
      selectionKey: publicRooms.map((room) => room.rateKey).join("|"),
      price: typeof fee === "number" ? applyMarkup(basePrice, fee) ?? basePrice : basePrice,
      currency: prebook.currency ?? details.currency ?? currency,
    };
    const response = NextResponse.json({ hotel: hotelSelection });
    setPrebookCookie(response, {
      sessionId: prebook.sessionId || details.sessionId, hotelCode, groupCode: group.groupCode,
      rateKeyHashes: rateKeys.map(hashRateKey),
      isBookable: prebook.isBookable, isPriceChanged: prebook.isPriceChanged,
      recordedAt: Date.now(),
    });
    return response;
  } catch (error) {
    console.error("[PackageAssistant] Hotel preparation failed", error);
    return NextResponse.json({ error: "Could not verify this hotel right now. Please try again." }, { status: 502 });
  }
}
