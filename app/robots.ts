import type { MetadataRoute } from "next";

const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, "");

const baseUrl = normalizeBaseUrl(
  process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXTAUTH_URL || "http://localhost:3000",
);

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/admin/",
        "/profile/",
        "/payment/",
        "/checkout/",
        "/*/admin",
        "/*/admin/",
        "/*/profile",
        "/*/profile/",
        "/*/payment",
        "/*/payment/",
        "/*/checkout",
        "/*/checkout/",
      ],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
