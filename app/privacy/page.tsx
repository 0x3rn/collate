import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { FormAlert } from "@/components/ui/alert";
import { getCurrentUser } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Privacy policy | Collate",
  description:
    "How Collate stores, protects, and deletes your account and research data (NDPA / GDPR).",
};

export default async function PrivacyPage() {
  const user = await getCurrentUser();

  return (
    <>
      <SiteHeader user={user} />
      <main className="flex-1 mx-auto w-full max-w-[740px] px-4 sm:px-6 py-12 space-y-8">
        <div className="space-y-2 border-b border-[var(--neutral-200)] pb-6">
          <h1 className="text-[2rem] font-medium">Privacy policy</h1>
          <p className="text-sm text-[var(--neutral-600)]">
            Pre-launch draft: Nigeria NDPA and EU GDPR legal review required before public launch.
          </p>
        </div>

        <FormAlert tone="warning">
          [CONFIRM: Data controller name, registered address, Data Protection Officer contact, and
          final retention schedule must be approved by counsel before public launch.]
        </FormAlert>

        <section className="space-y-4 text-[var(--neutral-700)] leading-relaxed">
          <h2 className="text-xl font-medium">1. Data we collect</h2>
          <p>
            We store your account profile, securely hashed password (PBKDF2-SHA256), project topics,
            retrieved source metadata, uploaded CSV datasets, generated chapters, exports, and
            payment references strictly to operate your account. Card details never touch Collate
            servers; payments are processed by Paystack and Stripe.
          </p>

          <h2 className="text-xl font-medium">2. No model training on your content</h2>
          <p>
            Your topics, datasets, and drafts are never used to train third-party AI models.
            Cross-user originality checks store only irreversible one-way shingle hashes, never your
            raw prose.
          </p>

          <h2 className="text-xl font-medium">3. Self-service data deletion (NDPA / GDPR)</h2>
          <p>
            You may permanently delete your account, all projects, uploaded datasets, chapters, and
            stored PDF/Word exports at any time from your{" "}
            <Link href="/account" className="text-[var(--accent-600)] underline underline-offset-4">
              Account page
            </Link>{" "}
            after re-entering your password.
          </p>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
