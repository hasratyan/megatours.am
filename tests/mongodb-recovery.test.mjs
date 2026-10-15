import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { MongoClient } from "mongodb";

// No .env loading or network: retain the driver's real connect() lock and replace
// only its network-opening operation. Exercise the app's DB and auth entry points.
const root = fileURLToPath(new URL("../", import.meta.url));
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@/lib/user-data") return { url: "mongo-test:user-data", shortCircuit: true };
    if (specifier.startsWith("@/")) return next(pathToFileURL(`${root}${specifier.slice(2)}.ts`).href, context);
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === "mongo-test:user-data") return { format: "module", shortCircuit: true, source: "export const upsertUserProfile = async () => {};" };
    if (url.startsWith(pathToFileURL(root).href) && url.endsWith(".ts")) return {
      format: "module", shortCircuit: true,
      source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText,
    };
    return next(url, context);
  },
});
Object.assign(process.env, {
  MONGODB_URI: "mongodb://database.invalid:27017",
  MONGODB_DB: "fixture_public", MONGODB_DB_B2B: "fixture_b2b",
  BETTER_AUTH_URL: "http://localhost:3101",
  BETTER_AUTH_SECRET: "fixture-only-auth-secret-not-for-deployment",
  GOOGLE_CLIENT_ID: "fixture", GOOGLE_CLIENT_SECRET: "fixture",
});

let attempts = 0;
let fail = true;
let release;
const originalConnect = MongoClient.prototype._connect;
MongoClient.prototype._connect = async function () {
  attempts++;
  if (fail) throw new Error("fixture connection unavailable");
  if (release !== undefined) await new Promise(resolve => { release = resolve; });
  return this;
};

const { default: client, connectMongoClient } = await import("../lib/mongodb.ts");
const { getDb, getB2bDb } = await import("../lib/db.ts");
const { auth } = await import("../lib/auth.ts");

test("DB and authentication recover after initial failure and share one client", async () => {
  try {
    assert.equal(attempts, 0, "importing auth must not connect or wait for the DB");
    assert.equal(typeof auth.options.database, "function", "adapter remains configured before connection");
    await assert.rejects(getDb(), /fixture connection unavailable/);
    await assert.rejects(auth.api.getSession({ headers: new Headers() }), /fixture connection unavailable/);
    assert.equal(attempts, 2, "auth tries a fresh connection after a failed DB request");
    fail = false;
    assert.equal(await auth.api.getSession({ headers: new Headers() }), null);
    assert.equal((await getDb()).databaseName, "fixture_public");
    assert.equal((await getB2bDb()).databaseName, "fixture_b2b");
    assert.equal(globalThis._mongoClient, client);
    const beforeConcurrent = attempts;
    release = null;
    const requests = Array.from({ length: 10 }, () => connectMongoClient());
    assert.equal(attempts, beforeConcurrent + 1, "driver shares concurrent connection attempts");
    release();
    assert.ok((await Promise.all(requests)).every(value => value === client));
  } finally {
    MongoClient.prototype._connect = originalConnect;
  }
});
