import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin";
import { getB2bDb } from "@/lib/db";

export const runtime = "nodejs";

type ManageRouteParams = {
  bookingId: string;
};

type ReviewStatus = "new" | "in_progress" | "needs_followup" | "resolved";

const allowedStatuses: readonly ReviewStatus[] = [
  "new",
  "in_progress",
  "needs_followup",
  "resolved",
];

const parseReviewStatus = (value: unknown): ReviewStatus | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return allowedStatuses.includes(normalized as ReviewStatus)
    ? (normalized as ReviewStatus)
    : null;
};

const parseNote = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 2000) : null;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<ManageRouteParams> }
) {
  try {
    const session = await getServerSession(authOptions);
    const adminUser = {
      id: session?.user?.id ?? null,
      email: session?.user?.email ?? null,
    };
    const isAdmin = isAdminUser(adminUser);
    if (!isAdmin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { bookingId } = await params;
    const normalizedBookingId = bookingId?.trim();
    if (!normalizedBookingId || !ObjectId.isValid(normalizedBookingId)) {
      return NextResponse.json({ error: "Invalid booking id." }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const status = parseReviewStatus((body as { status?: unknown }).status);
    if (!status) {
      return NextResponse.json({ error: "Invalid review status." }, { status: 400 });
    }

    const note = parseNote((body as { note?: unknown }).note);
    const updatedBy = adminUser.email ?? adminUser.id ?? null;
    const updatedAt = new Date();

    const db = await getB2bDb();
    const result = await db.collection("b2b_service_bookings").findOneAndUpdate(
      { _id: new ObjectId(normalizedBookingId) },
      {
        $set: {
          review: {
            status,
            note,
            updatedBy,
            updatedAt,
          },
          updatedAt,
        },
      },
      {
        returnDocument: "after",
        projection: { review: 1 },
      }
    );

    if (!result) {
      return NextResponse.json({ error: "Booking not found." }, { status: 404 });
    }

    const review = (result as { review?: { status?: unknown; note?: unknown; updatedBy?: unknown; updatedAt?: unknown } }).review;
    const responseStatus = parseReviewStatus(review?.status) ?? status;
    const responseNote = typeof review?.note === "string" ? review.note : note;
    const responseUpdatedBy = typeof review?.updatedBy === "string" ? review.updatedBy : updatedBy;
    const responseUpdatedAt =
      review?.updatedAt instanceof Date
        ? review.updatedAt.toISOString()
        : typeof review?.updatedAt === "string"
          ? review.updatedAt
          : updatedAt.toISOString();

    return NextResponse.json({
      message: "Review updated successfully.",
      review: {
        status: responseStatus,
        note: responseNote,
        updatedBy: responseUpdatedBy,
        updatedAt: responseUpdatedAt,
      },
    });
  } catch (error) {
    console.error("[Admin][b2b-bookings] Failed to update review", error);
    return NextResponse.json({ error: "Failed to update review." }, { status: 500 });
  }
}
