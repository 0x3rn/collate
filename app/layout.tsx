import { env } from "cloudflare:workers";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AutoHideScrollbar } from "@/components/layout/auto-hide-scrollbar";
import { RouteProgressBar } from "@/components/layout/route-progress-bar";
import { CookieConsentAnalytics } from "@/components/privacy/cookie-consent-analytics";
import { ToastProvider } from "@/components/ui/toast";
import { resolveGaMeasurementId } from "@/lib/privacy/cookie-consent";
import {
  GSC_VERIFICATION_TOKEN,
  OG_IMAGE_PATH,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TITLE,
  SITE_URL,
} from "@/lib/seo/site-metadata";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_TITLE,
    template: "%s",
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    "academic writing",
    "verified citations",
    "thesis writing",
    "research paper",
    "final year project",
    "academic assignments",
    "APA 7",
    "Harvard citations",
    "IEEE citations",
    "topic source check",
    "Collate",
  ],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    siteName: SITE_NAME,
    type: "website",
    locale: "en_US",
    images: [
      {
        url: OG_IMAGE_PATH,
        width: 1200,
        height: 630,
        alt: "Collate: check your topic against real sources, then write verified academic work",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [OG_IMAGE_PATH],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-snippet": -1,
      "max-image-preview": "large",
      "max-video-preview": -1,
    },
  },
  verification: {
    google: GSC_VERIFICATION_TOKEN,
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const gaMeasurementId = resolveGaMeasurementId(
    env as unknown as Record<string, unknown>,
    process.env
  );

  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Newsreader:wght@500;600&family=Plus+Jakarta+Sans:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen flex flex-col bg-[var(--neutral-50)] text-[var(--neutral-900)]">
        <RouteProgressBar />
        <ToastProvider>
          {children}
          <CookieConsentAnalytics measurementId={gaMeasurementId} />
          <AutoHideScrollbar />
        </ToastProvider>
      </body>
    </html>
  );
}
