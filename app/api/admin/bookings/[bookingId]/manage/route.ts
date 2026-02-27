import { NextRequest, NextResponse } from "next/server";
import { ObjectId, type Collection, type Document } from "mongodb";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin";
import { getDb } from "@/lib/db";
import { parseBookingAddonServices } from "@/lib/booking-addons";
import type {
  AoryxBookingGuestPayload,
  AoryxBookingPayload,
  BookingInsuranceTraveler,
} from "@/types/aoryx";

export const runtime = "nodejs";

type ManageRouteParams = {
  bookingId: string;
};

type ManageAction =
  | "update_guest_details"
  | "update_local_services"
  | "remove_local_services"
  | "update_contact";

type LocalServiceKey = "transfer" | "excursion" | "flight";

type AdminUserIdentity = {
  id: string | null;
  email: string | null;
};

type UserBookingRecord = {
  _id: ObjectId;
  userIdString?: string | null;
  payload?: AoryxBookingPayload | null;
};

const SUPPORT_LOCK_TTL_MS = 2 * 60 * 1000;
const MAX_HISTORY_ITEMS = 100;

const resolveString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const toNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const toBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "1"].includes(normalized)) return true;
    if (["false", "no", "0"].includes(normalized)) return false;
  }
  return undefined;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const normalizeEmail = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!email) return null;
  const basicEmailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!basicEmailPattern.test(email)) return null;
  return email;
};

const sanitizePayloadForAdmin = (payload: AoryxBookingPayload): AoryxBookingPayload => ({
  ...payload,
  sessionId: "",
  rooms: payload.rooms.map((room) => ({
    ...room,
    rateKey: "",
  })),
});

const sanitizeGuestEntry = (
  value: unknown,
  roomLabel: string,
  guestIndex: number
): AoryxBookingGuestPayload => {
  if (!isRecord(value)) {
    throw new Error(`Invalid guest payload at ${roomLabel}, guest ${guestIndex + 1}.`);
  }

  const firstName = resolveString(value.firstName);
  const lastName = resolveString(value.lastName);
  if (!firstName || !lastName) {
    throw new Error(`Guest first and last name are required at ${roomLabel}, guest ${guestIndex + 1}.`);
  }

  const typeRaw = resolveString(value.type).toLowerCase();
  const type: "Adult" | "Child" = typeRaw === "child" ? "Child" : "Adult";
  const age = toNumber(value.age);
  if (age === null || age < 0 || age > 120) {
    throw new Error(`Invalid guest age at ${roomLabel}, guest ${guestIndex + 1}.`);
  }

  return {
    title: resolveString(value.title) || null,
    titleCode: resolveString(value.titleCode) || null,
    firstName,
    lastName,
    isLeadGuest: toBoolean(value.isLeadGuest),
    type,
    age: Math.round(age),
  };
};

const sanitizeInsuranceTraveler = (value: unknown, index: number): BookingInsuranceTraveler => {
  if (!isRecord(value)) {
    throw new Error(`Invalid insurance traveler payload at index ${index + 1}.`);
  }

  const firstName = resolveString(value.firstName);
  const lastName = resolveString(value.lastName);
  if (!firstName || !lastName) {
    throw new Error(`Insurance traveler first and last name are required at index ${index + 1}.`);
  }

  const genderValue = resolveString(value.gender).toUpperCase();
  const gender: "M" | "F" | null =
    genderValue === "M" || genderValue === "MALE"
      ? "M"
      : genderValue === "F" || genderValue === "FEMALE"
      ? "F"
      : null;

  const residency = toBoolean(value.residency);
  const addressInput = isRecord(value.address) ? value.address : null;
  const premium = toNumber(value.premium);
  const policyPremium = toNumber(value.policyPremium);

  return {
    id: resolveString(value.id) || null,
    firstName,
    lastName,
    firstNameEn: resolveString(value.firstNameEn) || null,
    lastNameEn: resolveString(value.lastNameEn) || null,
    gender,
    birthDate: resolveString(value.birthDate) || null,
    residency: residency === undefined ? null : Boolean(residency),
    socialCard: resolveString(value.socialCard) || null,
    passportNumber: resolveString(value.passportNumber) || null,
    passportAuthority: resolveString(value.passportAuthority) || null,
    passportIssueDate: resolveString(value.passportIssueDate) || null,
    passportExpiryDate: resolveString(value.passportExpiryDate) || null,
    phone: resolveString(value.phone) || null,
    mobilePhone: resolveString(value.mobilePhone) || null,
    email: resolveString(value.email) || null,
    address: addressInput
      ? {
          full: resolveString(addressInput.full) || null,
          fullEn: resolveString(addressInput.fullEn) || null,
          country: resolveString(addressInput.country) || null,
          countryId: resolveString(addressInput.countryId) || null,
          region: resolveString(addressInput.region) || null,
          city: resolveString(addressInput.city) || null,
        }
      : null,
    citizenship: resolveString(value.citizenship) || null,
    premium: premium !== null && premium > 0 ? premium : null,
    premiumCurrency: resolveString(value.premiumCurrency) || null,
    policyPremium: policyPremium !== null && policyPremium > 0 ? policyPremium : null,
    subrisks: Array.isArray(value.subrisks)
      ? value.subrisks
          .map((entry) => resolveString(entry))
          .filter((entry): entry is string => entry.length > 0)
      : null,
  };
};

const parseAction = (value: unknown): ManageAction | null => {
  const normalized = resolveString(value).toLowerCase();
  if (
    normalized === "update_guest_details" ||
    normalized === "update_local_services" ||
    normalized === "remove_local_services" ||
    normalized === "update_contact"
  ) {
    return normalized;
  }
  return null;
};

const parseLocalServiceKeys = (value: unknown): LocalServiceKey[] => {
  if (!Array.isArray(value)) return [];
  const normalized = value
    .map((entry) => resolveString(entry).toLowerCase())
    .filter(
      (entry): entry is LocalServiceKey =>
        entry === "transfer" || entry === "excursion" || entry === "flight"
    );
  return Array.from(new Set(normalized));
};

const buildSupportHistoryEntry = (
  action: ManageAction,
  adminUser: AdminUserIdentity,
  details: Record<string, unknown>
) => ({
  id: new ObjectId().toString(),
  action,
  scope: "local_db_only",
  partnerSync: "not_sent",
  partnerPolicy:
    "Changes are stored locally only. No update request is sent to Aoryx or EFES from this admin action.",
  changedAt: new Date(),
  changedBy: {
    id: adminUser.id,
    email: adminUser.email,
  },
  details,
});

const acquireSupportLock = async (
  bookingId: ObjectId,
  adminUser: AdminUserIdentity
) => {
  const db = await getDb();
  const userBookings = db.collection("user_bookings");
  const now = new Date();
  const token = new ObjectId().toString();

  const lockFilters: Record<string, unknown>[] = [
    { supportLock: { $exists: false } },
    { "supportLock.expiresAt": { $lte: now } },
  ];
  if (adminUser.id) lockFilters.push({ "supportLock.by.id": adminUser.id });
  if (adminUser.email) lockFilters.push({ "supportLock.by.email": adminUser.email });

  const locked = (await userBookings.findOneAndUpdate(
    {
      _id: bookingId,
      $or: lockFilters,
    },
    {
      $set: {
        supportLock: {
          token,
          lockedAt: now,
          expiresAt: new Date(now.getTime() + SUPPORT_LOCK_TTL_MS),
          by: {
            id: adminUser.id,
            email: adminUser.email,
          },
        },
      },
    },
    {
      returnDocument: "after",
    }
  )) as UserBookingRecord | null;

  return {
    token,
    record: locked,
    userBookings,
  };
};

const releaseSupportLock = async (
  userBookings: Collection<Document>,
  bookingId: ObjectId,
  token: string
) => {
  await userBookings.updateOne(
    {
      _id: bookingId,
      "supportLock.token": token,
    },
    {
      $unset: {
        supportLock: "",
      },
    }
  );
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<ManageRouteParams> }
) {
  let lockToken: string | null = null;
  let userBookingsCollection: Collection<Document> | null = null;
  let bookingObjectId: ObjectId | null = null;

  try {
    const session = await getServerSession(authOptions);
    const adminUser: AdminUserIdentity = {
      id: session?.user?.id ?? null,
      email: session?.user?.email ?? null,
    };
    const isAdmin = isAdminUser(adminUser);
    if (!isAdmin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { bookingId } = await params;
    const normalizedBookingId = bookingId?.trim();
    if (!normalizedBookingId || !ObjectId.isValid(normalizedBookingId)) {
      return NextResponse.json({ error: "Invalid booking id." }, { status: 400 });
    }
    bookingObjectId = new ObjectId(normalizedBookingId);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = parseAction(body.action);
    if (!action) {
      return NextResponse.json({ error: "Invalid action." }, { status: 400 });
    }

    const lock = await acquireSupportLock(bookingObjectId, adminUser);
    lockToken = lock.token;
    userBookingsCollection = lock.userBookings;

    if (!lock.record) {
      return NextResponse.json(
        {
          error: "Booking is currently being managed by another admin. Please retry in a moment.",
          code: "booking_locked",
        },
        { status: 409 }
      );
    }

    const record = lock.record;
    if (!record.payload) {
      return NextResponse.json({ error: "Booking payload is missing." }, { status: 422 });
    }
    const payload = record.payload;
    const now = new Date();

    if (action === "update_guest_details") {
      const guestDetailsInput = isRecord(body.guestDetails) ? body.guestDetails : null;
      if (!guestDetailsInput) {
        return NextResponse.json({ error: "Missing guest details payload." }, { status: 400 });
      }

      const nextPayload: AoryxBookingPayload = {
        ...payload,
        rooms: payload.rooms.map((room) => ({ ...room, guests: [...room.guests] })),
        insurance: payload.insurance
          ? {
              ...payload.insurance,
              travelers: payload.insurance.travelers ? [...payload.insurance.travelers] : null,
            }
          : null,
      };

      let updatedRoomGuestsCount = 0;
      const roomsInput = Array.isArray(guestDetailsInput.rooms) ? guestDetailsInput.rooms : [];
      if (roomsInput.length > 0) {
        for (let roomIndex = 0; roomIndex < roomsInput.length; roomIndex += 1) {
          const roomInput = roomsInput[roomIndex];
          if (!isRecord(roomInput)) continue;
          const roomIdentifier = toNumber(roomInput.roomIdentifier);
          const targetIndex =
            roomIdentifier !== null
              ? nextPayload.rooms.findIndex((room) => room.roomIdentifier === Math.round(roomIdentifier))
              : roomIndex < nextPayload.rooms.length
              ? roomIndex
              : -1;
          if (targetIndex < 0) continue;

          if (!Array.isArray(roomInput.guests) || roomInput.guests.length === 0) {
            throw new Error(`Room ${targetIndex + 1} guest list is required.`);
          }

          const sanitizedGuests = roomInput.guests.map((guest, guestIndex) =>
            sanitizeGuestEntry(guest, `room ${targetIndex + 1}`, guestIndex)
          );
          nextPayload.rooms[targetIndex] = {
            ...nextPayload.rooms[targetIndex],
            guests: sanitizedGuests,
          };
          updatedRoomGuestsCount += 1;
        }
      }

      let updatedInsuranceTravelersCount = 0;
      if (Object.prototype.hasOwnProperty.call(guestDetailsInput, "insuranceTravelers")) {
        if (!nextPayload.insurance) {
          throw new Error("Insurance travelers can not be updated because this booking has no insurance.");
        }
        const insuranceTravelersInput = guestDetailsInput.insuranceTravelers;
        if (!Array.isArray(insuranceTravelersInput)) {
          throw new Error("insuranceTravelers must be an array.");
        }
        const travelers = insuranceTravelersInput.map((traveler, index) =>
          sanitizeInsuranceTraveler(traveler, index)
        );
        nextPayload.insurance = {
          ...nextPayload.insurance,
          travelers: travelers.length > 0 ? travelers : null,
        };
        updatedInsuranceTravelersCount = travelers.length;
      }

      if (updatedRoomGuestsCount === 0 && updatedInsuranceTravelersCount === 0) {
        return NextResponse.json(
          {
            error:
              "No guest updates were applied. Provide room guests and/or insurance travelers to update.",
          },
          { status: 400 }
        );
      }

      const historyEntry = buildSupportHistoryEntry(action, adminUser, {
        updatedRoomGuestsCount,
        updatedInsuranceTravelersCount,
        aoryxSync: "not_sent",
        efesSync: "not_sent",
      });

      await userBookingsCollection.updateOne(
        {
          _id: bookingObjectId,
          "supportLock.token": lockToken,
        },
        ({
          $set: {
            payload: nextPayload,
            updatedAt: now,
            supportUpdatedAt: now,
          },
          $push: {
            supportHistory: {
              $each: [historyEntry],
              $slice: -MAX_HISTORY_ITEMS,
            },
          },
        } as Document)
      );

      return NextResponse.json({
        message:
          "Guest details were updated locally. No update request was sent to Aoryx or EFES.",
        payload: sanitizePayloadForAdmin(nextPayload),
      });
    }

    if (action === "update_local_services") {
      const servicesInput = isRecord(body.services) ? body.services : null;
      if (!servicesInput) {
        return NextResponse.json({ error: "Missing local services payload." }, { status: 400 });
      }

      const hasTransfer = Object.prototype.hasOwnProperty.call(servicesInput, "transferSelection");
      const hasExcursions = Object.prototype.hasOwnProperty.call(servicesInput, "excursions");
      const hasFlights = Object.prototype.hasOwnProperty.call(servicesInput, "airTickets");
      if (!hasTransfer && !hasExcursions && !hasFlights) {
        return NextResponse.json(
          {
            error:
              "No local service keys found. Use transferSelection, excursions, and/or airTickets.",
          },
          { status: 400 }
        );
      }

      const parsed = parseBookingAddonServices(servicesInput);
      const nextPayload: AoryxBookingPayload = { ...payload };
      const changedServices: LocalServiceKey[] = [];

      if (hasTransfer) {
        nextPayload.transferSelection = parsed.transferSelection ?? null;
        changedServices.push("transfer");
      }
      if (hasExcursions) {
        nextPayload.excursions = parsed.excursions ?? null;
        changedServices.push("excursion");
      }
      if (hasFlights) {
        nextPayload.airTickets = parsed.airTickets ?? null;
        changedServices.push("flight");
      }

      const historyEntry = buildSupportHistoryEntry(action, adminUser, {
        changedServices,
        aoryxSync: "not_sent",
        efesSync: "not_sent",
      });

      await userBookingsCollection.updateOne(
        {
          _id: bookingObjectId,
          "supportLock.token": lockToken,
        },
        ({
          $set: {
            payload: nextPayload,
            updatedAt: now,
            supportUpdatedAt: now,
          },
          $push: {
            supportHistory: {
              $each: [historyEntry],
              $slice: -MAX_HISTORY_ITEMS,
            },
          },
        } as Document)
      );

      return NextResponse.json({
        message:
          "Local services were updated in DB. No update request was sent to Aoryx or EFES.",
        payload: sanitizePayloadForAdmin(nextPayload),
      });
    }

    if (action === "remove_local_services") {
      const serviceKeys = parseLocalServiceKeys(body.serviceKeys);
      if (serviceKeys.length === 0) {
        return NextResponse.json(
          { error: "Select at least one local service to remove." },
          { status: 400 }
        );
      }

      const nextPayload: AoryxBookingPayload = { ...payload };
      serviceKeys.forEach((key) => {
        if (key === "transfer") nextPayload.transferSelection = null;
        if (key === "excursion") nextPayload.excursions = null;
        if (key === "flight") nextPayload.airTickets = null;
      });

      const historyEntry = buildSupportHistoryEntry(action, adminUser, {
        removedServices: serviceKeys,
        aoryxSync: "not_sent",
        efesSync: "not_sent",
      });

      await userBookingsCollection.updateOne(
        {
          _id: bookingObjectId,
          "supportLock.token": lockToken,
        },
        ({
          $set: {
            payload: nextPayload,
            updatedAt: now,
            supportUpdatedAt: now,
          },
          $push: {
            supportHistory: {
              $each: [historyEntry],
              $slice: -MAX_HISTORY_ITEMS,
            },
          },
        } as Document)
      );

      return NextResponse.json({
        message:
          "Selected local services were removed from DB. No update request was sent to Aoryx or EFES.",
        payload: sanitizePayloadForAdmin(nextPayload),
      });
    }

    if (action === "update_contact") {
      const contactInput = isRecord(body.contact) ? body.contact : null;
      if (!contactInput) {
        return NextResponse.json({ error: "Missing contact payload." }, { status: 400 });
      }

      const nameValueRaw = resolveString(contactInput.name);
      const nameValue = nameValueRaw ? nameValueRaw.slice(0, 120) : null;
      const hasEmailField = Object.prototype.hasOwnProperty.call(contactInput, "email");
      const emailValue = hasEmailField ? normalizeEmail(contactInput.email) : null;
      if (hasEmailField && contactInput.email && !emailValue) {
        return NextResponse.json({ error: "Invalid email address." }, { status: 400 });
      }
      if (!nameValue && !hasEmailField) {
        return NextResponse.json(
          { error: "Provide at least one contact field to update." },
          { status: 400 }
        );
      }
      if (!record.userIdString) {
        return NextResponse.json(
          {
            error:
              "Contact can not be updated because booking owner is missing userIdString.",
          },
          { status: 422 }
        );
      }

      const db = await getDb();
      const userProfiles = db.collection("user_profiles");
      await userProfiles.updateOne(
        { userIdString: record.userIdString },
        {
          $set: {
            ...(nameValue !== null ? { name: nameValue } : {}),
            ...(hasEmailField
              ? {
                  email: emailValue,
                  emailLower: emailValue,
                }
              : {}),
            updatedAt: now,
          },
          $setOnInsert: {
            userIdString: record.userIdString,
            createdAt: now,
          },
        },
        { upsert: true }
      );

      const historyEntry = buildSupportHistoryEntry(action, adminUser, {
        updatedName: nameValue !== null,
        updatedEmail: hasEmailField,
        aoryxSync: "not_sent",
        efesSync: "not_sent",
      });

      await userBookingsCollection.updateOne(
        {
          _id: bookingObjectId,
          "supportLock.token": lockToken,
        },
        ({
          $set: {
            updatedAt: now,
            supportUpdatedAt: now,
          },
          $push: {
            supportHistory: {
              $each: [historyEntry],
              $slice: -MAX_HISTORY_ITEMS,
            },
          },
        } as Document)
      );

      return NextResponse.json({
        message:
          "Contact details were updated locally. No update request was sent to Aoryx or EFES.",
        contact: {
          name: nameValue,
          email: hasEmailField ? emailValue : null,
        },
      });
    }

    return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
  } catch (error) {
    console.error("[Admin][bookings][manage] Failed to process request", error);
    const message = error instanceof Error ? error.message : "Failed to manage booking.";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    if (lockToken && userBookingsCollection && bookingObjectId) {
      await releaseSupportLock(userBookingsCollection, bookingObjectId, lockToken).catch((releaseError) => {
        console.error("[Admin][bookings][manage] Failed to release support lock", releaseError);
      });
    }
  }
}
