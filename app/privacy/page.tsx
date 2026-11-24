import type { Metadata } from "next";
import { LegalDocumentView } from "@/components/legal/legal-document";
import { getCurrentUser } from "@/lib/auth/server";
import { PRIVACY_POLICY } from "@/lib/legal/privacy-policy";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Privacy Policy | Collate",
  description:
    "How Collate collects, protects, processes, and deletes your personal and research data under NDPA 2023, GDPR, UK GDPR, and CCPA/CPRA.",
};

export default async function PrivacyPage() {
  const user = await getCurrentUser();
  return <LegalDocumentView document={PRIVACY_POLICY} user={user} />;
}
