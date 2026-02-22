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

type BookingEmailCopy = {
  subject: (hotelName: string, bookingId: string) => string;
  header: {
    kicker: string;
    title: string;
    intro: (name: string) => string;
  };
  fallbackName: string;
  labels: {
    bookingId: string;
    hotel: string;
    dates: string;
    confirmation: string;
    coupon: string;
    totalPaid: string;
    includedServices: string;
    voucher: string;
    profile: string;
  };
  buttons: {
    voucher: string;
    profile: string;
  };
  supportHint: string;
  plainHeading: string;
  transferTypes: {
    individual: string;
    group: string;
  };
  words: {
    selected: string;
  };
  serviceLines: {
    hotel: (name: string) => string;
    transfer: (selection: string) => string;
    excursions: (count: number) => string;
    insurance: (selection: string) => string;
    flights: (selection: string) => string;
  };
};

const localeTagByLocale: Record<Locale, string> = {
  hy: "hy-AM",
  en: "en-GB",
  ru: "ru-RU",
};

const bookingEmailCopyByLocale: Record<Locale, BookingEmailCopy> = {
  hy: {
    subject: (hotelName, bookingId) => `Ամրագրումը հաստատված է: ${hotelName} (${bookingId})`,
    header: {
      kicker: "MEGATOURS",
      title: "Ձեր ամրագրումը հաստատված է",
      intro: (name) =>
        `Ողջույն ${name}, ձեր ուղևորության տվյալները պատրաստ են։ Պահեք այս նամակը՝ ճանապարհորդության ընթացքում արագ մուտքի համար։`,
    },
    fallbackName: "Ճանապարհորդ",
    labels: {
      bookingId: "Ամրագրման համարը",
      hotel: "Հյուրանոց",
      dates: "Ամսաթվեր",
      confirmation: "Հաստատում",
      coupon: "Զեղչային կոդ",
      totalPaid: "Ընդամենը վճարված",
      includedServices: "Ներառված ծառայություններ",
      voucher: "Վաուչեր",
      profile: "Պրոֆիլ",
    },
    buttons: {
      voucher: "Ներբեռնել վաուչերը",
      profile: "Բացել պրոֆիլը",
    },
    supportHint: "Եթե հարկավոր է աջակցություն, պատասխանեք այս նամակին, և մեր թիմը կօգնի ձեզ, կամ զանգահարեք +374 55 659965 հեռախոսահամարով։ Մենք հասանելի ենք 24/7։",
    plainHeading: "Ամրագրումը հաստատված է",
    transferTypes: {
      individual: "Անհատական",
      group: "Խմբային",
    },
    words: {
      selected: "Ընտրված",
    },
    serviceLines: {
      hotel: (name) => `Հյուրանոց: ${name}`,
      transfer: (selection) => `Տրանսֆեր: ${selection}`,
      excursions: (count) => `Էքսկուրսիաներ: ընտրված է ${count}`,
      insurance: (selection) => `Ապահովագրություն: ${selection}`,
      flights: (selection) => `Թռիչքներ: ${selection}`,
    },
  },
  en: {
    subject: (hotelName, bookingId) => `Booking confirmed: ${hotelName} (${bookingId})`,
    header: {
      kicker: "MEGATOURS",
      title: "Your booking is confirmed",
      intro: (name) =>
        `Hi ${name}, your trip details are ready. Keep this email for easy access while traveling.`,
    },
    fallbackName: "Traveler",
    labels: {
      bookingId: "Booking ID",
      hotel: "Hotel",
      dates: "Dates",
      confirmation: "Confirmation",
      coupon: "Coupon",
      totalPaid: "Total Paid",
      includedServices: "Included services",
      voucher: "Voucher",
      profile: "Profile",
    },
    buttons: {
      voucher: "Download voucher",
      profile: "Open profile",
    },
    supportHint: "Need help? Reply to this email and our team will assist you, or call us at +374 55 659965. We are available 24/7.",
    plainHeading: "Booking confirmed",
    transferTypes: {
      individual: "Individual",
      group: "Group",
    },
    words: {
      selected: "Selected",
    },
    serviceLines: {
      hotel: (name) => `Hotel: ${name}`,
      transfer: (selection) => `Transfer: ${selection}`,
      excursions: (count) => `Excursions: ${count} selected`,
      insurance: (selection) => `Insurance: ${selection}`,
      flights: (selection) => `Flights: ${selection}`,
    },
  },
  ru: {
    subject: (hotelName, bookingId) => `Бронирование подтверждено: ${hotelName} (${bookingId})`,
    header: {
      kicker: "MegaTours",
      title: "Ваше бронирование подтверждено",
      intro: (name) =>
        `Здравствуйте, ${name}! Детали поездки готовы. Сохраните это письмо для удобного доступа во время путешествия.`,
    },
    fallbackName: "Путешественник",
    labels: {
      bookingId: "Номер бронирования",
      hotel: "Отель",
      dates: "Даты",
      confirmation: "Подтверждение",
      coupon: "Купон",
      totalPaid: "Оплачено",
      includedServices: "Включенные услуги",
      voucher: "Ваучер",
      profile: "Профиль",
    },
    buttons: {
      voucher: "Скачать ваучер",
      profile: "Открыть профиль",
    },
    supportHint: "Если вам нужна помощь, ответьте на это письмо, и наша команда поможет вам, или позвоните нам по телефону +374 55 659965. Мы доступны 24/7.",
    plainHeading: "Бронирование подтверждено",
    transferTypes: {
      individual: "Индивидуальный",
      group: "Групповой",
    },
    words: {
      selected: "Выбрано",
    },
    serviceLines: {
      hotel: (name) => `Отель: ${name}`,
      transfer: (selection) => `Трансфер: ${selection}`,
      excursions: (count) => `Экскурсии: выбрано ${count}`,
      insurance: (selection) => `Страховка: ${selection}`,
      flights: (selection) => `Авиабилеты: ${selection}`,
    },
  },
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

const formatDateForLocale = (value: string, localeTag: string): string => {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  try {
    return new Intl.DateTimeFormat(localeTag, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(parsed);
  } catch {
    return value;
  }
};

const formatDateRange = (start: string | null | undefined, end: string | null | undefined, localeTag: string) => {
  if (!start || !end) return null;
  return `${formatDateForLocale(start, localeTag)} — ${formatDateForLocale(end, localeTag)}`;
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

const resolveTransferTypeLabel = (
  transferType: string | null | undefined,
  copy: BookingEmailCopy
): string | null => {
  const normalized = (transferType ?? "").trim().toUpperCase();
  if (normalized === "INDIVIDUAL") return copy.transferTypes.individual;
  if (normalized === "GROUP") return copy.transferTypes.group;
  return null;
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
  const localeTag = localeTagByLocale[safeLocale] ?? localeTagByLocale[defaultLocale];
  const copy = bookingEmailCopyByLocale[safeLocale] ?? bookingEmailCopyByLocale[defaultLocale];
  const baseUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://megatours.am").replace(/\/$/, "");
  const bookingId = payload.customerRefNumber ?? "—";
  const hotelName = payload.hotelName ?? payload.hotelCode ?? copy.labels.hotel;
  const dateRange = formatDateRange(payload.checkInDate, payload.checkOutDate, localeTag);
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
    formatCurrencyAmount(totalAmount, totalCurrency, localeTag) ?? `${totalAmount} ${totalCurrency}`;
  const confirmation =
    result?.hotelConfirmationNumber ??
    result?.supplierConfirmationNumber ??
    result?.adsConfirmationNumber ??
    "—";
  const normalizedCoupon = normalizeCoupon(coupon);
  const voucherUrl = `${baseUrl}/${safeLocale}/profile/voucher/${bookingId}?download=1`;
  const profileUrl = `${baseUrl}/${safeLocale}/profile`;

  const serviceLines: string[] = [];
  serviceLines.push(copy.serviceLines.hotel(hotelName));
  if (payload.transferSelection) {
    const route = [payload.transferSelection.origin?.name, payload.transferSelection.destination?.name]
      .filter(Boolean)
      .join(" → ");
    const transferTypeLabel = resolveTransferTypeLabel(payload.transferSelection.transferType, copy);
    const transferSelection = route || transferTypeLabel || copy.words.selected;
    serviceLines.push(copy.serviceLines.transfer(transferSelection));
  }
  if (payload.excursions) {
    const selectedCount = Math.max(1, payload.excursions.selections?.length ?? 1);
    serviceLines.push(copy.serviceLines.excursions(selectedCount));
  }
  if (payload.insurance) {
    const insuranceSelection =
      payload.insurance.planName?.trim() ||
      payload.insurance.planId?.trim() ||
      copy.words.selected;
    serviceLines.push(copy.serviceLines.insurance(insuranceSelection));
  }
  if (payload.airTickets) {
    const route = [payload.airTickets.origin, payload.airTickets.destination].filter(Boolean).join(" → ");
    serviceLines.push(copy.serviceLines.flights(route || copy.words.selected));
  }

  const safeName = name?.trim() || copy.fallbackName;
  const subject = copy.subject(hotelName, bookingId);
  const escapedVoucherUrl = escapeHtml(voucherUrl);
  const escapedProfileUrl = escapeHtml(profileUrl);
  const html = `
    <div style="margin: 0; padding: 24px; background: linear-gradient(160deg, #ecfeff 0%, #f8fafc 50%, #fefce8 100%); font-family: 'Segoe UI', Arial, sans-serif; color: #0f172a;">
      <div style="max-width: 680px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #0f766e 0%, #0ea5a6 100%); border-radius: 20px 20px 0 0; padding: 28px 28px 24px; color: #f8fafc;">
          <p style="text-transform: uppercase; letter-spacing: 0.18em; font-size: 11px; margin: 0 0 10px; opacity: 0.92;">${escapeHtml(copy.header.kicker)}</p>
          <h1 style="margin: 0; font-size: 28px; line-height: 1.2;">${escapeHtml(copy.header.title)}</h1>
          <p style="margin: 12px 0 0; font-size: 15px; line-height: 1.55;">${escapeHtml(copy.header.intro(safeName))}</p>
        </div>
        <div style="background: #ffffff; border: 1px solid #dbeafe; border-top: none; border-radius: 0 0 20px 20px; padding: 24px 28px 28px;">
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 14px; padding: 16px 18px;">
            <table role="presentation" cellspacing="0" cellpadding="0" style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 0 0 10px; color: #64748b; font-size: 13px;">${escapeHtml(copy.labels.bookingId)}</td>
                <td style="padding: 0 0 10px; text-align: right; font-weight: 700; font-size: 14px;">${escapeHtml(bookingId)}</td>
              </tr>
              <tr>
                <td style="padding: 0 0 10px; color: #64748b; font-size: 13px;">${escapeHtml(copy.labels.hotel)}</td>
                <td style="padding: 0 0 10px; text-align: right; font-weight: 600; font-size: 14px;">${escapeHtml(hotelName)}</td>
              </tr>
              ${
                dateRange
                  ? `<tr>
                <td style="padding: 0 0 10px; color: #64748b; font-size: 13px;">${escapeHtml(copy.labels.dates)}</td>
                <td style="padding: 0 0 10px; text-align: right; font-weight: 600; font-size: 14px;">${escapeHtml(dateRange)}</td>
              </tr>`
                  : ""
              }
              <tr>
                <td style="padding: 0 0 10px; color: #64748b; font-size: 13px;">${escapeHtml(copy.labels.confirmation)}</td>
                <td style="padding: 0 0 10px; text-align: right; font-weight: 700; font-size: 14px;">${escapeHtml(confirmation)}</td>
              </tr>
              ${
                normalizedCoupon
                  ? `<tr>
                <td style="padding: 0 0 10px; color: #64748b; font-size: 13px;">${escapeHtml(copy.labels.coupon)}</td>
                <td style="padding: 0 0 10px; text-align: right; font-weight: 600; font-size: 14px;">${escapeHtml(normalizedCoupon.code)} (${normalizedCoupon.discountPercent}%)</td>
              </tr>`
                  : ""
              }
              <tr>
                <td style="padding: 10px 0 0; color: #0f766e; font-size: 13px; font-weight: 700; border-top: 1px solid #cbd5e1;">${escapeHtml(copy.labels.totalPaid)}</td>
                <td style="padding: 10px 0 0; text-align: right; color: #0f766e; font-size: 18px; font-weight: 800; border-top: 1px solid #cbd5e1;">${escapeHtml(totalLabel)}</td>
              </tr>
            </table>
          </div>

          <div style="margin-top: 18px;">
            <p style="margin: 0 0 10px; font-size: 14px; font-weight: 700; color: #0f172a;">${escapeHtml(copy.labels.includedServices)}</p>
            <ul style="margin: 0; padding: 0 0 0 18px; color: #334155; font-size: 14px; line-height: 1.55;">
              ${serviceLines.map((item) => `<li style="margin: 0 0 6px;">${escapeHtml(item)}</li>`).join("")}
            </ul>
          </div>

          <div style="margin-top: 22px;">
            <a href="${escapedVoucherUrl}" style="display: inline-block; margin: 0 10px 10px 0; background: #0f766e; color: #ffffff; text-decoration: none; padding: 12px 18px; border-radius: 999px; font-weight: 700; font-size: 14px;">${escapeHtml(copy.buttons.voucher)}</a>
            <a href="${escapedProfileUrl}" style="display: inline-block; margin: 0 10px 10px 0; background: #e2e8f0; color: #0f172a; text-decoration: none; padding: 12px 18px; border-radius: 999px; font-weight: 700; font-size: 14px;">${escapeHtml(copy.buttons.profile)}</a>
          </div>

          <p style="margin: 12px 0 0; font-size: 12px; color: #64748b; line-height: 1.5;">${escapeHtml(copy.supportHint)}</p>
        </div>
      </div>
    </div>
  `;

  const text = [
    copy.plainHeading,
    `${copy.labels.bookingId}: ${bookingId}`,
    `${copy.labels.hotel}: ${hotelName}`,
    dateRange ? `${copy.labels.dates}: ${dateRange}` : null,
    `${copy.labels.confirmation}: ${confirmation}`,
    normalizedCoupon ? `${copy.labels.coupon}: ${normalizedCoupon.code} (${normalizedCoupon.discountPercent}%)` : null,
    `${copy.labels.totalPaid}: ${totalLabel}`,
    `${copy.labels.voucher}: ${voucherUrl}`,
    `${copy.labels.profile}: ${profileUrl}`,
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
