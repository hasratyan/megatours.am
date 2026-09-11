import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's built-in TypeScript test runner requires the source extension.
import { createEfesDiagnostics } from "../lib/efes-diagnostics.ts";

test("EFES diagnostics correlate a timed-out traveler and preserve the network cause", () => {
  const records: Record<string, unknown>[] = [];
  const capture = (line: string) => records.push(JSON.parse(line.replace("[EFES][diagnostic] ", "")));
  const info = console.info;
  const error = console.error;
  console.info = capture;
  console.error = capture;
  try {
    const log = createEfesDiagnostics({
      endpoint: "/webservice/policy", timeoutMs: 15000,
      context: { bookingId: "booking-1", attemptId: "attempt-1", travelerIndex: 2 },
    });
    log.phase("supplier_request");
    log.failure(new Error("fetch failed", {
      cause: Object.assign(new Error("connection timed out"), { code: "ETIMEDOUT" }),
    }), true);
    assert.equal(records[1].event, "request_failed");
    assert.equal(records[1].requestId, records[0].requestId);
    assert.equal(records[1].bookingId, "booking-1");
    assert.equal(records[1].attemptId, "attempt-1");
    assert.equal(records[1].travelerIndex, 2);
    assert.equal(records[1].phase, "supplier_request");
    assert.equal(records[1].timedOut, true);
    assert.equal(records[1].causeCode, "ETIMEDOUT");
    assert.equal(records[1].message, "fetch failed");
    assert.equal(typeof records[1].elapsedMs, "number");
    assert.equal(records[1].timeoutMs, 15000);
  } finally { console.info = info; console.error = error; }
});

test("EFES validation diagnostics retain codes while excluding credentials and echoed traveler data", () => {
  const lines: string[] = [];
  const info = console.info;
  const error = console.error;
  console.info = line => lines.push(line);
  console.error = line => lines.push(line);
  try {
    const log = createEfesDiagnostics({
      endpoint: "/webservice/policy", timeoutMs: 15000,
      secrets: ["secret-password", "secret-token"],
      request: { INSURED_NAME: "Jane", TRAVEL_PASSPORT_NUMBER: "AB1234567", INSURED_BIRTHDAY: "01.01.1990" },
    });
    log.headers(new Response(null, { status: 200, headers: { authorization: "secret-token" } }));
    log.response({
      is_error: 1, error_code: 4,
      error_msg: "Validation error - 0169 Jane AB1234567 01.01.1990 secret-password",
      jwt: "secret-token", result: "private-policy-number",
      unexpected: { passport: "never-log-this", email: "private@example.com" },
    }, 500);
    log.failure(new Error("fetch failed secret-token private@example.com"), false);
    const output = lines.join("\n");
    for (const secret of ["Jane", "AB1234567", "01.01.1990", "secret-password", "secret-token", "private-policy-number", "never-log-this", "private@example.com"]) {
      assert.ok(!output.includes(secret), `Leaked ${secret}`);
    }
    const response = JSON.parse(lines[2].replace("[EFES][diagnostic] ", ""));
    assert.equal(response.status, 200);
    assert.equal(response.supplier.error_code, "4");
    assert.match(response.supplier.error_msg, /Validation error - 0169/);
    assert.equal(response.hasResult, true);
  } finally { console.info = info; console.error = error; }
});

test("auth and HTML response bodies are never logged and logging errors do not escape", () => {
  const lines: string[] = [];
  const info = console.info;
  console.info = line => lines.push(line);
  try {
    const log = createEfesDiagnostics({ endpoint: "/webservice/auth", timeoutMs: 15000 });
    log.response({ jwt: "private-jwt", message: "private-auth-body" }, 100, true);
    log.response("<html>private-html-body</html>", 100);
    assert.doesNotMatch(lines.join("\n"), /private-/);
    console.info = () => { throw new Error("logging unavailable"); };
    assert.doesNotThrow(() => log.headers(new Response(null, { status: 502 })));
  } finally { console.info = info; }
});
