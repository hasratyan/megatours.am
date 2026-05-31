import { NextRequest, NextResponse } from "next/server";
import {
  roomDetails,
  roomDetailsBySession,
  AoryxServiceError,
  AoryxClientError,
} from "@/lib/aoryx-client";
import { AORYX_TASSPRO_CUSTOMER_CODE, AORYX_TASSPRO_REGION_ID } from "@/lib/env";
import type { AoryxSearchParams, AoryxRoomSearch } from "@/types/aoryx";
import { decodeSearchToken, hashSearchRooms, obfuscateRoomOptions } from "@/lib/aoryx-rate-tokens";
import { getAoryxHotelPlatformFee } from "@/lib/pricing";
import { applyMarkup } from "@/lib/pricing-utils";
import { localizeAoryxRoomOptions } from "@/lib/aoryx-room-localization";
import { resolveTranslationLocale } from "@/lib/text-translation";
import { setSessionCookie } from "../_shared";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const hotelCode =
      typeof body.hotelCode === "string" && body.hotelCode.trim().length > 0
        ? body.hotelCode.trim()
        : undefined;
    const destinationCode =
      typeof body.destinationCode === "string" && body.destinationCode.trim().length > 0
        ? body.destinationCode.trim()
        : undefined;
    const countryCode =
      typeof body.countryCode === "string" ? body.countryCode.trim() : "AE";
    const nationality =
      typeof body.nationality === "string" ? body.nationality.trim() : "AM";
    const currency =
      typeof body.currency === "string" ? body.currency.trim() : "USD";
    const requestedLocale = resolveTranslationLocale(
      typeof body.locale === "string"
        ? body.locale
        : request.headers.get("x-locale") ?? request.headers.get("accept-language")
    );
    const checkInDate =
      typeof body.checkInDate === "string" && body.checkInDate.trim().length > 0
        ? body.checkInDate.trim()
        : undefined;
    const checkOutDate =
      typeof body.checkOutDate === "string" && body.checkOutDate.trim().length > 0
        ? body.checkOutDate.trim()
        : undefined;

    if (!hotelCode) {
      return NextResponse.json({ error: "hotelCode is required" }, { status: 400 });
    }

    if (!checkInDate || !checkOutDate) {
      return NextResponse.json(
        { error: "checkInDate and checkOutDate are required" },
        { status: 400 }
      );
    }

    let rooms: AoryxRoomSearch[] = [];
    if (Array.isArray(body.rooms) && body.rooms.length > 0) {
      rooms = body.rooms.map((room: Record<string, unknown>, index: number) => ({
        roomIdentifier: typeof room.roomIdentifier === "number" ? room.roomIdentifier : index + 1,
        adults: typeof room.adults === "number" ? room.adults : 2,
        childrenAges: Array.isArray(room.childrenAges)
          ? room.childrenAges.filter((age): age is number => typeof age === "number")
          : [],
      }));
    } else {
      rooms = [{ roomIdentifier: 1, adults: 2, childrenAges: [] }];
    }

    const params: AoryxSearchParams = {
      destinationCode,
      hotelCode,
      countryCode,
      nationality,
      checkInDate,
      checkOutDate,
      currency,
      regionId: AORYX_TASSPRO_REGION_ID,
      customerCode: AORYX_TASSPRO_CUSTOMER_CODE,
      rooms,
    };

    let explicitSessionId =
      typeof body.sessionId === "string" && body.sessionId.trim().length > 0
        ? body.sessionId.trim()
        : null;
    const searchToken =
      typeof body.searchToken === "string" && body.searchToken.trim().length > 0
        ? body.searchToken.trim()
        : null;
    if (searchToken) {
      try {
        const decoded = decodeSearchToken(searchToken);
        const mismatch =
          (decoded.hotelCode && decoded.hotelCode !== hotelCode) ||
          (decoded.destinationCode && decoded.destinationCode !== (destinationCode ?? null)) ||
          (decoded.countryCode && decoded.countryCode.toUpperCase() !== countryCode.toUpperCase()) ||
          (decoded.nationality && decoded.nationality.toUpperCase() !== nationality.toUpperCase()) ||
          (decoded.currency && decoded.currency.toUpperCase() !== currency.toUpperCase()) ||
          (decoded.checkInDate && decoded.checkInDate !== checkInDate) ||
          (decoded.checkOutDate && decoded.checkOutDate !== checkOutDate) ||
          (decoded.roomsHash && decoded.roomsHash !== hashSearchRooms(rooms));
        if (mismatch) {
          return NextResponse.json(
            { error: "Search token does not match room details request" },
            { status: 409 }
          );
        }
        explicitSessionId = decoded.sessionId;
      } catch {
        return NextResponse.json(
          { error: "Invalid search token. Please search again." },
          { status: 400 }
        );
      }
    }

    const reusableSessionId = explicitSessionId;
    const loadRoomDetails = async () => {
      if (!reusableSessionId) return roomDetails(params);
      return roomDetailsBySession(reusableSessionId, params);
    };

    const [result, hotelMarkup] = await Promise.all([
      loadRoomDetails(),
      getAoryxHotelPlatformFee().catch((error) => {
        console.error("[Pricing] Failed to load hotel platform fee", error);
        return null;
      }),
    ]);
    const obfuscatedRooms = obfuscateRoomOptions(result.rooms, {
      sessionId: result.sessionId,
      hotelCode,
    });
    const localizedRooms =
      requestedLocale === "en"
        ? obfuscatedRooms
        : await localizeAoryxRoomOptions(obfuscatedRooms, requestedLocale).catch((error) => {
            console.error("[Aoryx][room-details] Failed to localize room content", error);
            return obfuscatedRooms;
          });
    const roomsWithDisplayPrice =
      typeof hotelMarkup === "number"
        ? localizedRooms.map((room) => ({
            ...room,
            displayTotalPrice:
              typeof room.totalPrice === "number" && Number.isFinite(room.totalPrice)
                ? applyMarkup(room.totalPrice, hotelMarkup) ?? room.totalPrice
                : room.totalPrice,
          }))
        : localizedRooms;
    const response = NextResponse.json({
      currency: result.currency ?? null,
      rooms: roomsWithDisplayPrice,
    });
    setSessionCookie(response, result.sessionId);

    return response;
  } catch (error) {
    console.error("Room details error:", error);

    if (error instanceof AoryxServiceError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 400 }
      );
    }

    if (error instanceof AoryxClientError) {
      return NextResponse.json(
        { error: error.message, code: "AORYX_UNAVAILABLE" },
        { status: 502 }
      );
    }

    return NextResponse.json(
      { error: "Failed to load room options" },
      { status: 500 }
    );
  }
}
