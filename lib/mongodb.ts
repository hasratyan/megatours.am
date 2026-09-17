import { MongoClient } from "mongodb";
import dns from "node:dns";

// Preserve the deployment's IPv4 preference.
if (typeof window === "undefined") {
  dns.setDefaultResultOrder("ipv4first");
}

type GlobalWithMongo = typeof globalThis & {
  _mongoClient?: MongoClient;
};

const uri = typeof process.env.MONGODB_URI === "string" ? process.env.MONGODB_URI.trim() : "";
const globalWithMongo = globalThis as GlobalWithMongo;

// Constructing a client does not open a connection. Keep the same client/pool
// across requests and development reloads, without caching a rejected promise.
const mongoClient = uri ? (globalWithMongo._mongoClient ??= new MongoClient(uri)) : null;

export async function connectMongoClient(): Promise<MongoClient> {
  if (!mongoClient) {
    throw new Error("MongoDB connection is not configured. Set MONGODB_URI.");
  }
  // The driver deduplicates concurrent connects, returns immediately when
  // connected, and releases its connection lock after a failed attempt.
  return mongoClient.connect();
}

export default mongoClient;
