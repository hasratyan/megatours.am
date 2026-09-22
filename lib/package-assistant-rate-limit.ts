import { getDb } from "@/lib/db";

type Bucket = { _id: string; count: number; expiresAt: Date };
const WINDOW_MS = 60 * 60 * 1000;
const LIMITS = { chat: 60, prepare: 20 } as const;
let indexPromise: Promise<string> | null = null;

export async function consumeAssistantRateLimit(
  ownerKey: string,
  action: keyof typeof LIMITS
): Promise<{ allowed: boolean; retryAfter: number }> {
  const now = Date.now();
  const nextWindow = (Math.floor(now / WINDOW_MS) + 1) * WINDOW_MS;
  const db = await getDb();
  const buckets = db.collection<Bucket>("package_assistant_rate_limits");
  indexPromise ??= buckets.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await indexPromise.catch((error) => {
    indexPromise = null;
    console.error("[PackageAssistant] Rate-limit TTL index unavailable", error);
  });
  const id = `${action}:${ownerKey}:${Math.floor(now / WINDOW_MS)}`;
  const result = await buckets.findOneAndUpdate(
    { _id: id },
    { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(nextWindow + WINDOW_MS) } },
    { upsert: true, returnDocument: "after" }
  );
  return {
    allowed: (result?.count ?? LIMITS[action] + 1) <= LIMITS[action],
    retryAfter: Math.max(1, Math.ceil((nextWindow - now) / 1000)),
  };
}
