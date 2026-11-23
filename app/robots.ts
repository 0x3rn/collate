import type { MetadataRoute } from "next";

/**
 * Intentionally avoids listing private /admin or /api/internal routes as a roadmap
 * (protected by authentication/authorization instead).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
  };
}
