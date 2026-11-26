import { CREDIT_PACKS } from "@/config/pricing";
import { LEGAL_CONFIG } from "@/lib/legal/config";
import { LANDING_FAQS } from "@/lib/marketing/landing-content";

export const SITE_URL = "https://collateresearch.app";
export const SITE_NAME = "Collate";
export const SITE_TITLE = "Collate | Verified Academic Projects, Theses & Assignments";
export const SITE_DESCRIPTION =
  "Check your topic against real academic sources first, then write verified projects, research papers, theses, and assignments with real citations and print-ready PDF and Word export.";
export const OG_IMAGE_PATH = "/og-image.png";

/** Google Search Console HTML meta tag verification token for https://collateresearch.app */
export const GSC_VERIFICATION_TOKEN = "D3BtiHqz322m3kLEKweh-J2QYoX5bjeppF7oYVAL9-Y";

export const PUBLIC_INDEXABLE_ROUTES = [
  { path: "/", changeFrequency: "weekly" as const, priority: 1.0 },
  { path: "/terms", changeFrequency: "monthly" as const, priority: 0.4 },
  { path: "/privacy", changeFrequency: "monthly" as const, priority: 0.4 },
  { path: "/acceptable-use", changeFrequency: "monthly" as const, priority: 0.4 },
  { path: "/cookies", changeFrequency: "monthly" as const, priority: 0.4 },
] as const;

export function buildLandingJsonLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${SITE_URL}/#organization`,
        name: SITE_NAME,
        url: SITE_URL,
        logo: {
          "@type": "ImageObject",
          url: `${SITE_URL}${OG_IMAGE_PATH}`,
          width: 1200,
          height: 630,
        },
        contactPoint: [
          {
            "@type": "ContactPoint",
            contactType: "customer support",
            email: LEGAL_CONFIG.supportEmail,
            availableLanguage: ["English"],
          },
          {
            "@type": "ContactPoint",
            contactType: "privacy",
            email: LEGAL_CONFIG.privacyEmail,
            availableLanguage: ["English"],
          },
        ],
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        name: SITE_NAME,
        url: SITE_URL,
        description: SITE_DESCRIPTION,
        inLanguage: "en",
        publisher: { "@id": `${SITE_URL}/#organization` },
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${SITE_URL}/#software`,
        name: SITE_NAME,
        url: SITE_URL,
        applicationCategory: "EducationalApplication",
        operatingSystem: "Web",
        description: SITE_DESCRIPTION,
        image: `${SITE_URL}${OG_IMAGE_PATH}`,
        publisher: { "@id": `${SITE_URL}/#organization` },
        featureList: [
          "Pre-writing topic feasibility check against verified academic databases",
          "Supports undergraduate projects, research papers, theses, and multi-question assignments",
          "Verified citations in APA 7, Harvard, MLA 9, Chicago, IEEE, and Vancouver styles",
          "Automatic statistical tables computed from uploaded CSV research datasets",
          "Chapter-by-chapter review with originality checks and writing logs",
          "Print-ready PDF and editable Word (.docx) export",
        ],
        offers: CREDIT_PACKS.map((pack) => ({
          "@type": "Offer",
          name: `${pack.label} (${pack.credits} credits)`,
          description: pack.description,
          price: (pack.amountUsdCents / 100).toFixed(2),
          priceCurrency: "USD",
          availability: "https://schema.org/InStock",
          url: `${SITE_URL}/#pricing`,
        })),
      },
      {
        "@type": "FAQPage",
        "@id": `${SITE_URL}/#faq`,
        mainEntity: LANDING_FAQS.map((faq) => ({
          "@type": "Question",
          name: faq.question,
          acceptedAnswer: {
            "@type": "Answer",
            text: faq.answer,
          },
        })),
      },
    ],
  };
}

/** Escapes `<` to prevent script-tag breakout when embedding JSON-LD in HTML. */
export function serializeJsonLd(data: Record<string, unknown>): string {
  return JSON.stringify(data).replaceAll("<", "\\u003c");
}
