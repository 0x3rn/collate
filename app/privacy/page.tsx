import type { Metadata } from "next";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { FormAlert } from "@/components/ui/alert";
import { getCurrentUser } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Privacy policy — Collate",
  description: "Draft privacy policy explaining how Collate stores and protects user data.",
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
            Pre-launch draft — NDPA (Nigeria) and GDPR legal review required before public launch.
          </p>
        </div>

        <FormAlert tone="warning">
          [CONFIRM: Data controller details, NDPA/GDPR contact address, retention windows, and
          sub-processor list must be reviewed by counsel in Phase 12.]
        </FormAlert>

        <section className="space-y-4 text-[var(--neutral-700)] leading-relaxed">
          <h2 className="text-xl font-medium">1. Data we collect</h2>
          <p>
            We store your name, email address, securely hashed password, project settings, retrieved
            sources, and generated chapter versions solely to operate your account and projects.
          </p>

          <h2 className="text-xl font-medium">2. No model training on your work</h2>
          <p>
            Your topics, uploaded datasets, and drafts are never used to train third-party AI
            models. Access to every project is strictly scoped to the account that created it.
          </p>

          <h2 className="text-xl font-medium">3. Deletion and security</h2>
          <p>
            Session tokens are hashed before storage and transmitted only via HttpOnly cookies. Full
            self-service account and project data deletion will be finalized before public launch.
          </p>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
