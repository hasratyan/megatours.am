import type { Collection, Document, Filter } from "mongodb";
import {
  createEfesPoliciesFromBooking,
  EfesPolicyIssuanceError,
} from "@/lib/efes-client";
import type { AoryxBookingPayload } from "@/types/aoryx";

export type BookingAddonInsuranceIssuanceOutcome = {
  status: "not_requested" | "confirmed" | "failed";
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
    const insurancePolicies = await createEfesPoliciesFromBooking(input.payload);
    await input.userBookings.updateOne(input.bookingFilter, ({
      $set: {
        insurancePolicies,
        insuranceUpdatedAt: new Date(),
      },
      $unset: { insuranceError: "" },
      $addToSet: { "addonLastPayment.appliedServices": "insurance" },
      $pull: { "addonLastPayment.failedServices": "insurance" },
    }) as Document);
    return {
      status: "confirmed",
      insurancePolicies,
      insuranceError: null,
    };
  } catch (error) {
    const insurancePolicies =
      error instanceof EfesPolicyIssuanceError ? error.policyResults : [];
    const insuranceError =
      error instanceof Error ? error.message : "Failed to create EFES policies";
    await input.userBookings.updateOne(input.bookingFilter, ({
      $set: {
        insurancePolicies,
        insuranceError,
        insuranceUpdatedAt: new Date(),
      },
      $addToSet: { "addonLastPayment.failedServices": "insurance" },
      $pull: { "addonLastPayment.appliedServices": "insurance" },
    }) as Document);
    console.error("[BookingAddons] EFES policy creation failed", {
      ...input.logContext,
      message: insuranceError,
    });
    return {
      status: "failed",
      insurancePolicies,
      insuranceError,
    };
  }
};
