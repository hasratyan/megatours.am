import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's TypeScript runner requires source extensions.
import { executeEfesPolicy, type EfesPolicyStore, type EfesPolicyAttempt } from "../lib/efes-policy-execution.ts";
// @ts-expect-error Node's TypeScript runner requires source extensions.
import { resolveInsuranceIssuance, resolveEfesPolicyResponseFailure, hasDefinitiveEfesRejection, hasIssuedEfesPolicy, INSURANCE_CONFIRMATION_PENDING } from "../lib/insurance-policy-status.ts";
// @ts-expect-error Node's TypeScript runner requires source extensions.
import { resolveBookingAddonPaymentServiceOutcome } from "../lib/booking-addon-payment-outcome.ts";

const classify = (response: unknown): EfesPolicyAttempt["state"] =>
  resolveEfesPolicyResponseFailure(response) === null ? "confirmed"
    : hasDefinitiveEfesRejection(response) ? "rejected" : "pending";
const success = (number: string) => ({ is_error: 0, error_code: 0, result: number });
function memoryStore() {
  const entries = new Map<string, EfesPolicyAttempt>();
  const store: EfesPolicyStore = {
    async claim(attempt) {
      const existing = entries.get(attempt._id);
      if (existing) return { claimed: false, attempt: existing };
      entries.set(attempt._id, attempt);
      return { claimed: true, attempt };
    },
    async save(id, state, result) {
      const entry = entries.get(id)!;
      entries.set(id, { ...entry, state, result });
    },
  };
  return { store, entries };
}
const request = (store: EfesPolicyStore, index: number, send: () => Promise<unknown>) => ({
  id: `policy-${index}`, requestHash: "request-1", travelerId: `traveler-${index}`, travelerIndex: index,
  store, send, classify,
});

test("one timeout retains every other policy and makes the overall booking pending", async () => {
  const { store, entries } = memoryStore();
  const results = await Promise.all([0, 1, 2, 3].map(i => executeEfesPolicy(request(store, i, async () => {
    if (i === 0) throw new Error("timeout");
    await new Promise(resolve => setTimeout(resolve, i));
    return success(`RT${i}`);
  }))));
  assert.equal(results.length, 4);
  assert.equal(results[0].confirmationStatus, "pending");
  for (const i of [1, 2, 3]) {
    assert.deepEqual(results[i].response, success(`RT${i}`));
    assert.equal(entries.get(`policy-${i}`)?.state, "confirmed");
  }
  assert.equal(hasIssuedEfesPolicy(results), true);
  assert.deepEqual(resolveInsuranceIssuance({ insuranceSelected: true, insurancePolicies: results, insuranceError: INSURANCE_CONFIRMATION_PENDING }), { status: "pending", errorMessage: null });
  assert.deepEqual(resolveBookingAddonPaymentServiceOutcome({ appliedServices: ["insurance", "transfer"], failedServices: ["insurance"], insuranceStatus: "pending" }), { appliedServices: ["transfer"], failedServices: [] });
});

test("all delayed policies are retained and confirmed", async () => {
  const { store } = memoryStore();
  const results = await Promise.all([0, 1, 2, 3].map(i => executeEfesPolicy(request(store, i, async () => {
    await new Promise(resolve => setTimeout(resolve, 4 - i));
    return success(`RT${i}`);
  }))));
  assert.equal(resolveInsuranceIssuance({ insuranceSelected: true, insurancePolicies: results }).status, "confirmed");
});

test("unknown outcomes and confirmed policies are not reissued, even after edited input", async () => {
  const { store } = memoryStore();
  let sends = 0;
  const send = async () => { sends++; throw new Error("socket reset"); };
  await executeEfesPolicy(request(store, 0, send));
  await executeEfesPolicy({ ...request(store, 0, send), requestHash: "edited" });
  assert.equal(sends, 1);
  await executeEfesPolicy(request(store, 1, async () => { sends++; return success("RT1"); }));
  const replay = await executeEfesPolicy({ ...request(store, 1, send), requestHash: "edited" });
  assert.deepEqual(replay.response, success("RT1"));
  assert.equal(sends, 2);
});

test("concurrent attempts claim a policy once; a later read recovers its result", async () => {
  const { store } = memoryStore();
  let finish!: () => void;
  const pause = new Promise<void>(resolve => { finish = resolve; });
  let sends = 0;
  const input = request(store, 0, async () => { sends++; await pause; return success("RT1"); });
  const first = executeEfesPolicy(input);
  const second = await executeEfesPolicy(input);
  assert.equal(second.confirmationStatus, "pending");
  finish();
  await first;
  const recovered = await executeEfesPolicy(input);
  assert.deepEqual(recovered.response, success("RT1"));
  assert.equal(sends, 1);
});

test("a process-interrupted pending claim cannot expire into a duplicate submission", async () => {
  const { store, entries } = memoryStore();
  await store.claim({ _id: "policy-0", requestHash: "request-1", state: "pending", result: { travelerId: "traveler-0", travelerIndex: 0, response: null, confirmationStatus: "pending" }, createdAt: new Date(0), updatedAt: new Date(0) });
  let sent = false;
  const result = await executeEfesPolicy(request(store, 0, async () => { sent = true; return success("duplicate"); }));
  assert.equal(sent, false);
  assert.equal(result.confirmationStatus, "pending");
  assert.equal(entries.get("policy-0")?.state, "pending");
});

test("supplier rejections remain failures; malformed success bodies remain uncertain", async () => {
  const { store } = memoryStore();
  const rejected = await executeEfesPolicy(request(store, 0, async () => ({ is_error: 1, error_code: 4, error_msg: "Validation error - 0094" })));
  const failure = resolveInsuranceIssuance({ insuranceSelected: true, insurancePolicies: [rejected] });
  assert.equal(failure.status, "failed");
  assert.match(failure.errorMessage ?? "", /0094/);
  const unknown = await executeEfesPolicy(request(store, 1, async () => ({ is_error: 0 })));
  assert.equal(unknown.confirmationStatus, "pending");
});

test("no supplier call is made without durable storage; save failures retain known successes", async () => {
  const { store } = memoryStore();
  const originalError = console.error;
  console.error = () => {};
  try {
    let sent = false;
    const unavailable = { ...store, claim: async () => { throw new Error("db down"); } };
    const pending = await executeEfesPolicy(request(unavailable, 0, async () => { sent = true; return success("RT1"); }));
    assert.equal(sent, false);
    assert.equal(pending.confirmationStatus, "pending");
    const result = await executeEfesPolicy(request({ ...store, save: async () => { throw new Error("db down"); } }, 1, async () => success("RT2")));
    assert.deepEqual(result.response, success("RT2"));
  } finally { console.error = originalError; }
});
