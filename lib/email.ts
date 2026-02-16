import nodemailer from "nodemailer";
import type { AoryxBookingPayload, AoryxBookingResult } from "@/types/aoryx";
import { calculateBookingTotal } from "@/lib/booking-total";
import { formatCurrencyAmount } from "@/lib/currency";
import { defaultLocale, Locale, locales } from "@/lib/i18n";
import { getAoryxHotelPlatformFee } from "@/lib/pricing";
import type { AppliedBookingCoupon } from "@/lib/user-data";

type BookingEmailInput = {
  to: string;
  name?: string | null;
  payload: AoryxBookingPayload;
  result?: AoryxBookingResult | null;
  locale?: string | null;
  paidAmount?: number | null;
  paidCurrency?: string | null;
  coupon?: AppliedBookingCoupon | null;
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const resolveLocale = (value?: string | null): Locale => {
  if (!value) return defaultLocale;
  return locales.includes(value as Locale) ? (value as Locale) : defaultLocale;
};

const formatDateRange = (start?: string | null, end?: string | null) => {
  if (!start || !end) return null;
  return `${start} — ${end}`;
};

const normalizeDisplayCurrency = (value: string | null | undefined): string | null => {
  const normalized = (value ?? "").trim().toUpperCase();
  if (!normalized) return null;
  if (normalized === "051") return "AMD";
  if (normalized === "840") return "USD";
  if (normalized === "978") return "EUR";
  if (normalized === "643") return "RUB";
  return normalized;
};

const normalizeCoupon = (value: AppliedBookingCoupon | null | undefined) => {
  if (!value) return null;
  const code = typeof value.code === "string" ? value.code.trim().toUpperCase() : "";
  const discountPercent =
    typeof value.discountPercent === "number" && Number.isFinite(value.discountPercent)
      ? Math.min(100, Math.max(0, value.discountPercent))
      : null;
  if (!code || discountPercent === null || discountPercent <= 0) return null;
  return {
    code,
    discountPercent,
  };
};

const buildTransport = () => {
  const host = process.env.SMTP_HOST?.trim();
  const port = Number(process.env.SMTP_PORT ?? "587");
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  if (!host || !user || !pass) return null;
  const secure = port === 465;
  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
};

export async function sendBookingConfirmationEmail({
  to,
  name,
  payload,
  result,
  locale,
  paidAmount,
  paidCurrency,
  coupon,
}: BookingEmailInput) {
  if (!to) return false;
  const transport = buildTransport();
  if (!transport) {
    console.warn("[Email] Missing SMTP configuration. Skipping booking email.");
    return false;
  }

  const from =
    process.env.EMAIL_FROM?.trim() ||
    process.env.SMTP_FROM?.trim() ||
    process.env.SMTP_USER?.trim() ||
    "";
  if (!from) {
    console.warn("[Email] Missing FROM address. Skipping booking email.");
    return false;
  }

  const safeLocale = resolveLocale(locale);
  const baseUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://megatours.am").replace(/\/$/, "");
  const bookingId = payload.customerRefNumber ?? "—";
  const hotelName = payload.hotelName ?? payload.hotelCode ?? "Hotel";
  const dateRange = formatDateRange(payload.checkInDate, payload.checkOutDate);
  const hotelMarkup = await getAoryxHotelPlatformFee();
  const total = calculateBookingTotal(payload, { hotelMarkup });
  const normalizedPaidAmount =
    typeof paidAmount === "number" && Number.isFinite(paidAmount) ? paidAmount : null;
  const totalAmount = normalizedPaidAmount ?? total;
  const totalCurrency =
    normalizeDisplayCurrency(normalizedPaidAmount !== null ? paidCurrency : null) ??
    normalizeDisplayCurrency(payload.currency) ??
    "USD";
  const totalLabel =
    formatCurrencyAmount(totalAmount, totalCurrency, "en-GB") ?? `${totalAmount} ${totalCurrency}`;
  const confirmation =
    result?.hotelConfirmationNumber ??
    result?.supplierConfirmationNumber ??
    result?.adsConfirmationNumber ??
    "—";
  const normalizedCoupon = normalizeCoupon(coupon);
  const voucherUrl = `${baseUrl}/${safeLocale}/profile/voucher/${bookingId}?download=1`;
  const profileUrl = `${baseUrl}/${safeLocale}/profile`;

  const services: string[] = [];
  services.push(`Hotel: ${hotelName}`);
  if (payload.transferSelection) {
    const route = [payload.transferSelection.origin?.name, payload.transferSelection.destination?.name]
      .filter(Boolean)
      .join(" → ");
    services.push(`Transfer: ${route || payload.transferSelection.transferType || "Selected"}`);
  }
  if (payload.excursions) {
    services.push(`Excursions: ${payload.excursions.selections?.length ?? 1} selected`);
  }
  if (payload.insurance) {
    services.push(`Insurance: ${payload.insurance.planName ?? payload.insurance.planId}`);
  }
  if (payload.airTickets) {
    const route = [payload.airTickets.origin, payload.airTickets.destination].filter(Boolean).join(" → ");
    services.push(`Flights: ${route || "Selected"}`);
  }

  const safeName = name?.trim() || "Traveler";
  const subject = `Booking confirmed: ${hotelName} (${bookingId})`;
  const escapedVoucherUrl = escapeHtml(voucherUrl);
  const escapedProfileUrl = escapeHtml(profileUrl);
  const html = `
    <div style="margin: 0; padding: 24px; background: linear-gradient(160deg, #ecfeff 0%, #f8fafc 50%, #fefce8 100%); font-family: 'Segoe UI', Arial, sans-serif; color: #0f172a;">
      <div style="max-width: 680px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #0f766e 0%, #0ea5a6 100%); border-radius: 20px 20px 0 0; padding: 28px 28px 24px; color: #f8fafc;">
          <p style="text-transform: uppercase; letter-spacing: 0.18em; font-size: 11px; margin: 0 0 10px; opacity: 0.92;">MegaTours</p>
          <h1 style="margin: 0; font-size: 28px; line-height: 1.2;">Your booking is confirmed</h1>
          <p style="margin: 12px 0 0; font-size: 15px; line-height: 1.55;">Hi ${escapeHtml(safeName)}, your trip details are ready. Keep this email for easy access while traveling.</p>
        </div>
        <div style="background: #ffffff; border: 1px solid #dbeafe; border-top: none; border-radius: 0 0 20px 20px; padding: 24px 28px 28px;">
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 14px; padding: 16px 18px;">
            <table role="presentation" cellspacing="0" cellpadding="0" style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 0 0 10px; color: #64748b; font-size: 13px;">Booking ID</td>
                <td style="padding: 0 0 10px; text-align: right; font-weight: 700; font-size: 14px;">${escapeHtml(bookingId)}</td>
              </tr>
              <tr>
                <td style="padding: 0 0 10px; color: #64748b; font-size: 13px;">Hotel</td>
                <td style="padding: 0 0 10px; text-align: right; font-weight: 600; font-size: 14px;">${escapeHtml(hotelName)}</td>
              </tr>
              ${
                dateRange
                  ? `<tr>
                <td style="padding: 0 0 10px; color: #64748b; font-size: 13px;">Dates</td>
                <td style="padding: 0 0 10px; text-align: right; font-weight: 600; font-size: 14px;">${escapeHtml(dateRange)}</td>
              </tr>`
                  : ""
              }
              <tr>
                <td style="padding: 0 0 10px; color: #64748b; font-size: 13px;">Confirmation</td>
                <td style="padding: 0 0 10px; text-align: right; font-weight: 700; font-size: 14px;">${escapeHtml(confirmation)}</td>
              </tr>
              ${
                normalizedCoupon
                  ? `<tr>
                <td style="padding: 0 0 10px; color: #64748b; font-size: 13px;">Coupon</td>
                <td style="padding: 0 0 10px; text-align: right; font-weight: 600; font-size: 14px;">${escapeHtml(normalizedCoupon.code)} (${normalizedCoupon.discountPercent}%)</td>
              </tr>`
                  : ""
              }
              <tr>
                <td style="padding: 10px 0 0; color: #0f766e; font-size: 13px; font-weight: 700; border-top: 1px solid #cbd5e1;">Total Paid</td>
                <td style="padding: 10px 0 0; text-align: right; color: #0f766e; font-size: 18px; font-weight: 800; border-top: 1px solid #cbd5e1;">${escapeHtml(totalLabel)}</td>
              </tr>
            </table>
          </div>

          <div style="margin-top: 18px;">
            <p style="margin: 0 0 10px; font-size: 14px; font-weight: 700; color: #0f172a;">Included services</p>
            <ul style="margin: 0; padding: 0 0 0 18px; color: #334155; font-size: 14px; line-height: 1.55;">
              ${services.map((item) => `<li style="margin: 0 0 6px;">${escapeHtml(item)}</li>`).join("")}
            </ul>
          </div>

          <div style="margin-top: 22px;">
            <a href="${escapedVoucherUrl}" style="display: inline-block; margin: 0 10px 10px 0; background: #0f766e; color: #ffffff; text-decoration: none; padding: 12px 18px; border-radius: 999px; font-weight: 700; font-size: 14px;">Download voucher</a>
            <a href="${escapedProfileUrl}" style="display: inline-block; margin: 0 10px 10px 0; background: #e2e8f0; color: #0f172a; text-decoration: none; padding: 12px 18px; border-radius: 999px; font-weight: 700; font-size: 14px;">Open profile</a>
          </div>

          <p style="margin: 12px 0 0; font-size: 12px; color: #64748b; line-height: 1.5;">Need help? Reply to this email and our team will assist you.</p>
        </div>
      </div>
    </div>
  `;

  const text = [
    `Booking confirmed`,
    `Booking ID: ${bookingId}`,
    `Hotel: ${hotelName}`,
    dateRange ? `Dates: ${dateRange}` : null,
    `Confirmation: ${confirmation}`,
    normalizedCoupon ? `Coupon: ${normalizedCoupon.code} (${normalizedCoupon.discountPercent}%)` : null,
    `Total: ${totalLabel}`,
    `Voucher: ${voucherUrl}`,
    `Profile: ${profileUrl}`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    await transport.sendMail({
      from,
      to,
      subject,
      html,
      text,
    });
    return true;
  } catch (error) {
    console.error("[Email] Failed to send booking confirmation", error);
    return false;
  }
}
