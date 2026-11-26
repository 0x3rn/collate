import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo/site-metadata";

/**
 * Intentionally avoids listing private /admin or /api/internal routes as a roadmap
 * (protected by authentication/authorization and page-level noindex headers instead).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
