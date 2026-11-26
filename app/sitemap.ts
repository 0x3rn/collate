import type { MetadataRoute } from "next";
import { PUBLIC_INDEXABLE_ROUTES, SITE_URL } from "@/lib/seo/site-metadata";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date("2026-11-26T00:00:00.000Z");
  return PUBLIC_INDEXABLE_ROUTES.map((route) => ({
    url: `${SITE_URL}${route.path === "/" ? "" : route.path}`,
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
