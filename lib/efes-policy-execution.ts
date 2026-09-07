import { createHash } from "node:crypto";

export type EfesPolicyResult = {
  policyAttemptId?: string;
  travelerId: string | null;
  travelerIndex: number;
  confirmationStatus?: "pending";
  response: unknown;
};

export type EfesPolicyAttempt = {
  _id: string;
  requestHash: string;
  state: "pending" | "confirmed" | "rejected";
  result: EfesPolicyResult;
  createdAt: Date;
  updatedAt: Date;
};

export type EfesPolicyStore = {
  claim(attempt: EfesPolicyAttempt): Promise<{ claimed: boolean; attempt: EfesPolicyAttempt }>;
  save(id: string, state: EfesPolicyAttempt["state"], result: EfesPolicyResult): Promise<void>;
};

export const efesPolicyHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

// Every request settles independently. An uncertain attempt remains claimed even
// after a process restart: a local timeout cannot cancel a policy at EFES.
export async function executeEfesPolicy(input: {
  id: string;
  requestHash: string;
  travelerId: string | null;
  travelerIndex: number;
  store: EfesPolicyStore;
  send(): Promise<unknown>;
  classify(response: unknown): "confirmed" | "rejected" | "pending";
}): Promise<EfesPolicyResult> {
  const pending: EfesPolicyResult = {
    policyAttemptId: input.id,
    travelerId: input.travelerId, travelerIndex: input.travelerIndex, confirmationStatus: "pending", response: null,
  };
  const now = new Date();
  let claim;
  try {
    claim = await input.store.claim({
      _id: input.id, requestHash: input.requestHash, state: "pending", result: pending,
      createdAt: now, updatedAt: now,
    });
  } catch {
    // Never send an untracked request if persistence is unavailable.
    console.error("[EFES][policy-storage] Unable to claim policy attempt", { attemptId: input.id });
    return pending;
  }
  if (!claim.claimed) return { ...claim.attempt.result, travelerId: input.travelerId, travelerIndex: input.travelerIndex };
  let result = pending;
  let state: EfesPolicyAttempt["state"] = "pending";
  try {
    const response = await input.send();
    state = input.classify(response);
    result = { policyAttemptId: input.id, travelerId: input.travelerId, travelerIndex: input.travelerIndex, response,
      ...(state === "pending" ? { confirmationStatus: "pending" as const } : {}) };
  } catch {
    // Transport failures are unknown outcomes, never proof of supplier rejection.
  }
  try { await input.store.save(input.id, state, result); } catch {
    console.error("[EFES][policy-storage] Unable to save policy response; reconciliation required", { attemptId: input.id });
  }
  return result;
}
