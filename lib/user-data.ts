import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import type { AoryxSearchParams, AoryxBookingPayload, AoryxBookingResult } from "@/types/aoryx";

type UserIdInfo = {
  userId: ObjectId | string;
  userIdString: string;
};

const normalizeUserId = (userId: string): UserIdInfo => {
  const normalized = userId.trim();
  const objectId = ObjectId.isValid(normalized) ? new ObjectId(normalized) : null;
  return {
    userId: objectId ?? normalized,
    userIdString: normalized,
  };
};

export async function upsertUserProfile(input: {
  userId: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  provider?: string | null;
  providerAccountId?: string | null;
}) {
  const { userId, name, email, image, provider, providerAccountId } = input;
  const db = await getDb();
  const now = new Date();
  const ids = normalizeUserId(userId);

  await db.collection("user_profiles").updateOne(
    { userIdString: ids.userIdString },
    {
      $set: {
        ...ids,
        name: name ?? null,
        email: email ?? null,
        image: image ?? null,
        provider: provider ?? null,
        providerAccountId: providerAccountId ?? null,
        lastLoginAt: now,
        updatedAt: now,
      },
      $setOnInsert: {
        createdAt: now,
      },
    },
    { upsert: true }
  );
}

export async function recordUserSearch(input: {
  userId: string;
  params: AoryxSearchParams;
  resultSummary?: {
    propertyCount?: number | null;
    destinationCode?: string | null;
    destinationName?: string | null;
  };
  source?: string;
}) {
  const { userId, params, resultSummary, source } = input;
  const db = await getDb();
  const now = new Date();
  const ids = normalizeUserId(userId);

  await db.collection("user_searches").insertOne({
    ...ids,
    source: source ?? "aoryx",
    createdAt: now,
    params,
    resultSummary: resultSummary ?? null,
  });

  await db.collection("user_profiles").updateOne(
    { userIdString: ids.userIdString },
    { $set: { lastSearchAt: now } },
    { upsert: true }
  );
}

export async function recordUserBooking(input: {
  userId: string;
  payload: AoryxBookingPayload;
  result: AoryxBookingResult;
  source?: string;
}) {
  const { userId, payload, result, source } = input;
  const db = await getDb();
  const now = new Date();
  const ids = normalizeUserId(userId);

  await db.collection("user_bookings").insertOne({
    ...ids,
    source: source ?? "aoryx",
    createdAt: now,
    booking: result,
    payload,
  });

  await db.collection("user_profiles").updateOne(
    { userIdString: ids.userIdString },
    { $set: { lastBookingAt: now } },
    { upsert: true }
  );
}
