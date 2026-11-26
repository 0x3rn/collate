import type { Metadata } from "next";
import { LegalDocumentView } from "@/components/legal/legal-document";
import { getCurrentUser } from "@/lib/auth/server";
import { COOKIE_POLICY } from "@/lib/legal/cookie-policy";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Cookie & Local Storage Policy | Collate",
  description:
    "Complete inventory of Collate's strictly necessary session and security cookies, opt-in Google Analytics consent rules, and payment checkout cookies.",
  alternates: { canonical: "/cookies" },
};

export default async function CookiePolicyPage() {
  const user = await getCurrentUser();
  return <LegalDocumentView document={COOKIE_POLICY} user={user} />;
}
