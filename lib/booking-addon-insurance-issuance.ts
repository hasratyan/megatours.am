import { hasPendingEfesPolicy } from "@/lib/insurance-policy-status";
import type { Collection, Document, Filter } from "mongodb";
import {
  createEfesPoliciesFromBooking,
  EfesPolicyIssuanceError,
} from "@/lib/efes-client";
import type { AoryxBookingPayload } from "@/types/aoryx";

export type BookingAddonInsuranceIssuanceOutcome = {
  status: "not_requested" | "confirmed" | "pending" | "failed";
  insurancePolicies: unknown[];
  insuranceError: string | null;
};

export const issueBookingAddonInsurance = async (input: {
  userBookings: Collection<Document>;
  bookingFilter: Filter<Document>;
  payload: AoryxBookingPayload;
  shouldIssue: boolean;
  logContext: Record<string, unknown>;
}): Promise<BookingAddonInsuranceIssuanceOutcome> => {
  if (!input.shouldIssue) {
    return {
      status: "not_requested",
      insurancePolicies: [],
      insuranceError: null,
    };
  }

  try {
    const insurancePolicies = await createEfesPoliciesFromBooking(input.payload, {
      bookingId: typeof input.logContext.bookingId === "string" ? input.logContext.bookingId : undefined,
      flow: typeof input.logContext.flow === "string" ? input.logContext.flow : undefined,
    });
    await input.userBookings.updateOne(input.bookingFilter, ({
      $set: {
        insurancePolicies,
        insuranceUpdatedAt: new Date(),
      },
      $unset: { insuranceError: "" },
      $addToSet: { "addonLastPayment.appliedServices": "insurance" },
      $pull: { "addonLastPayment.failedServices": "insurance", "addonLastPayment.pendingServices": "insurance" },
    }) as Document);
    return {
      status: "confirmed",
      insurancePolicies,
      insuranceError: null,
    };
  } catch (error) {
    const insurancePolicies =
      error instanceof EfesPolicyIssuanceError ? error.policyResults : [];
    const pending = hasPendingEfesPolicy(insurancePolicies);
    const insuranceError =
      error instanceof Error ? error.message : "Failed to create EFES policies";
    await input.userBookings.updateOne(input.bookingFilter, ({
      $set: {
        insurancePolicies,
        insuranceError,
        insuranceUpdatedAt: new Date(),
      },
      ...(pending ? {
        $addToSet: { "addonLastPayment.pendingServices": "insurance" },
        $pull: { "addonLastPayment.appliedServices": "insurance", "addonLastPayment.failedServices": "insurance" },
      } : {
        $addToSet: { "addonLastPayment.failedServices": "insurance" },
        $pull: { "addonLastPayment.appliedServices": "insurance", "addonLastPayment.pendingServices": "insurance" },
      }),
    }) as Document);
    (pending ? console.info : console.error)(pending ? "[BookingAddons] EFES confirmation pending" : "[BookingAddons] EFES policy creation failed", {
      ...input.logContext,
      message: insuranceError,
    });
    return {
      status: pending ? "pending" : "failed",
      insurancePolicies,
      insuranceError,
    };
  }
};
