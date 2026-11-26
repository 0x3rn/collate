import type { Metadata } from "next";
import { LegalDocumentView } from "@/components/legal/legal-document";
import { getCurrentUser } from "@/lib/auth/server";
import { ACCEPTABLE_USE_POLICY } from "@/lib/legal/acceptable-use-policy";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Acceptable Use Policy | Collate",
  description:
    "Academic integrity standards, prohibited content rules, file upload requirements, security boundaries, and enforcement policy for Collate.",
  alternates: { canonical: "/acceptable-use" },
};

export default async function AcceptableUsePage() {
  const user = await getCurrentUser();
  return <LegalDocumentView document={ACCEPTABLE_USE_POLICY} user={user} />;
}
