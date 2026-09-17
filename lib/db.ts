import { connectMongoClient } from "@/lib/mongodb";

export async function getDb() {
  const client = await connectMongoClient();
  const dbName = typeof process.env.MONGODB_DB === "string" ? process.env.MONGODB_DB.trim() : "";
  const resolvedDbName = dbName.length > 0 ? dbName : "megatours_am";
  return client.db(resolvedDbName);
}

export async function getB2bDb() {
  const client = await connectMongoClient();
  const dbName = process.env.MONGODB_DB_B2B ?? process.env.MONGODB_DB;
  return dbName ? client.db(dbName) : client.db();
}
