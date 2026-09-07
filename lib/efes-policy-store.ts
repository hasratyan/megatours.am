import { getDb } from "@/lib/db";
import type { EfesPolicyAttempt, EfesPolicyStore } from "@/lib/efes-policy-execution";
import { hasPendingEfesPolicy, resolveInsuranceIssuance, INSURANCE_CONFIRMATION_PENDING } from "@/lib/insurance-policy-status";

// Read durable results on page reload, including responses saved after another
// concurrent request rendered a pending booking or the booking write failed.
export async function refreshEfesPolicyResults(record: {
  insurancePolicies?: unknown;
  insuranceError?: unknown;
} | null) {
  if (!record || !hasPendingEfesPolicy(record.insurancePolicies)) return;
  const policies = record.insurancePolicies as Array<{ policyAttemptId?: string; travelerId?: string | null; travelerIndex?: number }>;
  const ids = policies.flatMap(p => p.policyAttemptId ? [p.policyAttemptId] : []);
  if (!ids.length) return;
  try {
    const entries = await (await getDb()).collection<EfesPolicyAttempt>("efes_policy_attempts").find({ _id: { $in: ids } }).toArray();
    const byId = new Map(entries.map(entry => [entry._id, entry]));
    record.insurancePolicies = policies.map(policy => {
      const entry = policy.policyAttemptId ? byId.get(policy.policyAttemptId) : undefined;
      return entry ? { ...entry.result, travelerId: policy.travelerId, travelerIndex: policy.travelerIndex } : policy;
    });
    const summary = resolveInsuranceIssuance({ insuranceSelected: true, insurancePolicies: record.insurancePolicies });
    record.insuranceError = summary.status === "pending" ? INSURANCE_CONFIRMATION_PENDING : summary.errorMessage;
  } catch {
    // A temporarily unavailable ledger must not turn pending into failed.
  }
}

export async function getEfesPolicyStore(): Promise<EfesPolicyStore> {
  const collection = (await getDb()).collection<EfesPolicyAttempt>("efes_policy_attempts");
  return {
    async claim(attempt) {
      try {
        await collection.insertOne(attempt);
        return { claimed: true, attempt };
      } catch (error) {
        if ((error as { code?: number })?.code !== 11000) throw error;
        const existing = await collection.findOne({ _id: attempt._id });
        if (!existing) throw new Error("EFES attempt disappeared");
        // Corrected data may be resubmitted only after an explicit EFES rejection.
        if (existing.state === "rejected" && existing.requestHash !== attempt.requestHash) {
          const updated = await collection.findOneAndUpdate(
            { _id: attempt._id, state: "rejected", requestHash: existing.requestHash },
            { $set: { state: "pending", requestHash: attempt.requestHash, result: attempt.result, updatedAt: new Date() } },
            { returnDocument: "after" }
          );
          if (updated) return { claimed: true, attempt: updated };
          const current = await collection.findOne({ _id: attempt._id });
          if (!current) throw new Error("EFES attempt disappeared");
          return { claimed: false, attempt: current };
        }
        return { claimed: false, attempt: existing };
      }
    },
    async save(id, state, result) {
      await collection.updateOne({ _id: id, state: "pending" }, { $set: { state, result, updatedAt: new Date() } });
    },
  };
}
