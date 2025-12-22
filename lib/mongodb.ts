import { MongoClient } from "mongodb";

type GlobalWithMongo = typeof globalThis & {
  _mongoClientPromise?: Promise<MongoClient>;
};

const uri = typeof process.env.MONGODB_URI === "string" ? process.env.MONGODB_URI.trim() : "";

const globalWithMongo = global as GlobalWithMongo;

let clientPromise: Promise<MongoClient> | null = null;

if (uri.length > 0) {
  try {
    const client = new MongoClient(uri);
    clientPromise = globalWithMongo._mongoClientPromise ?? client.connect();
    globalWithMongo._mongoClientPromise = clientPromise;
  } catch (error) {
    console.error("[MongoDB] Invalid MONGODB_URI", error);
    clientPromise = null;
  }
}

export default clientPromise;
