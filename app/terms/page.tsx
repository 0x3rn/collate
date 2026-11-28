import type { Metadata } from "next";
import { LegalDocumentView } from "@/components/legal/legal-document";
import { getCurrentUser } from "@/lib/auth/server";
import { TERMS_POLICY } from "@/lib/legal/terms-policy";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Terms of Service & Refund Policy | Collate",
  description:
    "Collate Terms of Service, prepaid credit pack billing, academic integrity responsibilities, and Refund Policy.",
  alternates: { canonical: "/terms" },
};

export default async function TermsPage() {
  const user = await getCurrentUser();
  return <LegalDocumentView document={TERMS_POLICY} user={user} />;
}
