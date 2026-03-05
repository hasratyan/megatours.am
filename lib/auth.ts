import { ObjectId } from "mongodb";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { mongodbAdapter } from "@better-auth/mongo-adapter";
import clientPromise from "@/lib/mongodb";
import { upsertUserProfile } from "@/lib/user-data";

type BetterAuthSessionShape = {
  session?: {
    expiresAt?: unknown;
  } | null;
  user?: {
    id?: unknown;
    legacyUserId?: unknown;
    name?: unknown;
    email?: unknown;
    image?: unknown;
  } | null;
} | null;

export type AppSession = {
  user?: {
    id?: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
  expires?: string;
};

const authDbName =
  typeof process.env.MONGODB_DB === "string" && process.env.MONGODB_DB.trim().length > 0
    ? process.env.MONGODB_DB.trim()
    : "megatours_am";

const mongoClient =
  clientPromise
    ? await clientPromise.catch((error) => {
        console.error("[Auth] Mongo client initialization failed", error);
        return null;
      })
    : null;

const authDb = mongoClient ? mongoClient.db(authDbName) : null;
const authAdapter =
  authDb && mongoClient
    ? mongodbAdapter(authDb, {
        client: mongoClient,
        transaction: false,
      })
    : undefined;

const toTrimmedString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const toDateIsoString = (value: unknown): string | null => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
};

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const toObjectId = (value: string): ObjectId | null =>
  ObjectId.isValid(value) ? new ObjectId(value) : null;

const findLegacyUserIdByEmail = async (email: string): Promise<string | null> => {
  if (!authDb) return null;
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return null;

  const profile = await authDb.collection("user_profiles").findOne(
    {
      $or: [
        { emailLower: normalizedEmail },
        { email: { $regex: `^${escapeRegex(normalizedEmail)}$`, $options: "i" } },
      ],
    },
    {
      projection: { userIdString: 1 },
    }
  );

  return toTrimmedString((profile as Record<string, unknown> | null)?.userIdString);
};

const persistLegacyUserId = async (authUserId: string, legacyUserId: string) => {
  if (!authDb) return;
  const objectId = toObjectId(authUserId);
  if (!objectId) return;
  await authDb
    .collection<Record<string, unknown>>("user")
    .updateOne({ _id: objectId }, { $set: { legacyUserId } });
};

export const resolveEffectiveUserId = async (input: {
  authUserId?: string | null;
  email?: string | null;
  legacyUserId?: string | null;
}): Promise<string | null> => {
  const explicitLegacyId = toTrimmedString(input.legacyUserId);
  if (explicitLegacyId) return explicitLegacyId;

  const authUserId = toTrimmedString(input.authUserId);
  if (!authUserId) return null;

  const email = toTrimmedString(input.email);
  if (!email) return authUserId;

  const legacyByEmail = await findLegacyUserIdByEmail(email);
  if (!legacyByEmail || legacyByEmail === authUserId) return authUserId;

  await persistLegacyUserId(authUserId, legacyByEmail);
  return legacyByEmail;
};

const syncUserProfileOnSessionCreate = async (authUserIdRaw: unknown) => {
  if (!authDb) return;

  const authUserId = toTrimmedString(authUserIdRaw);
  if (!authUserId) return;

  const usersCollection = authDb.collection<Record<string, unknown>>("user");
  const authUserObjectId = toObjectId(authUserId);
  const userByObjectId = authUserObjectId
    ? await usersCollection.findOne({ _id: authUserObjectId })
    : null;
  const user = (userByObjectId ??
    (await usersCollection.findOne({
      id: authUserId,
    }))) as Record<string, unknown> | null;

  if (!user) return;

  const name = toTrimmedString(user.name);
  const email = toTrimmedString(user.email);
  const image = toTrimmedString(user.image);
  const userLegacyId = toTrimmedString(user.legacyUserId);

  const effectiveUserId = await resolveEffectiveUserId({
    authUserId,
    email,
    legacyUserId: userLegacyId,
  });

  if (!effectiveUserId) return;

  const accountUserIdRef = toObjectId(authUserId) ?? authUserId;
  const account = (await authDb.collection<Record<string, unknown>>("account").findOne(
    { userId: accountUserIdRef },
    {
      sort: {
        updatedAt: -1,
        createdAt: -1,
      },
    }
  )) as Record<string, unknown> | null;

  const provider = toTrimmedString(account?.providerId);
  const providerAccountId = toTrimmedString(account?.accountId);

  try {
    await upsertUserProfile({
      userId: effectiveUserId,
      name,
      email,
      image,
      provider,
      providerAccountId,
    });
  } catch (error) {
    console.error("[Auth] Failed to sync user profile", error);
  }
};

export const auth = betterAuth({
  ...(authAdapter ? { database: authAdapter } : {}),
  baseURL:
    (typeof process.env.BETTER_AUTH_URL === "string" && process.env.BETTER_AUTH_URL.trim()) ||
    (typeof process.env.NEXTAUTH_URL === "string" && process.env.NEXTAUTH_URL.trim()) ||
    undefined,
  secret:
    (typeof process.env.BETTER_AUTH_SECRET === "string" && process.env.BETTER_AUTH_SECRET.trim()) ||
    (typeof process.env.NEXTAUTH_SECRET === "string" && process.env.NEXTAUTH_SECRET.trim()) ||
    undefined,
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    },
  },
  user: {
    additionalFields: {
      legacyUserId: {
        type: "string",
        required: false,
        input: false,
      },
    },
  },
  databaseHooks: {
    session: {
      create: {
        after: async (session) => {
          await syncUserProfileOnSessionCreate(session.userId);
        },
      },
    },
  },
  plugins: [nextCookies()],
});

// Compatibility export so existing server callsites can stay unchanged during migration.
export const authOptions = {};

export const toAppSession = async (session: BetterAuthSessionShape): Promise<AppSession | null> => {
  if (!session?.user) return null;

  const authUserId = toTrimmedString(session.user.id);
  const name = toTrimmedString(session.user.name);
  const email = toTrimmedString(session.user.email);
  const image = toTrimmedString(session.user.image);

  const resolvedUserId = await resolveEffectiveUserId({
    authUserId,
    email,
    legacyUserId: toTrimmedString(session.user.legacyUserId),
  });

  return {
    user: {
      id: resolvedUserId ?? authUserId ?? undefined,
      name,
      email,
      image,
    },
    expires: toDateIsoString(session.session?.expiresAt) ?? undefined,
  };
};
