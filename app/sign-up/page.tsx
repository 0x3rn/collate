import { env } from "cloudflare:workers";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { getCurrentUser } from "@/lib/auth/server";
import { resolveTurnstileSiteKey } from "@/lib/security/turnstile";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Create account | Collate",
  description: "Create a Collate account to start checking topics and drafting chapters.",
};

export default async function SignUpPage() {
  const user = await getCurrentUser();
  if (user) {
    redirect("/dashboard");
  }

  const turnstileSiteKey = resolveTurnstileSiteKey(
    env as unknown as Record<string, unknown>,
    process.env
  );

  return (
    <>
      <SiteHeader user={null} />
      <main className="flex-1 mx-auto w-full max-w-[460px] px-4 sm:px-6 py-12 sm:py-16">
        <div className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-6 sm:p-8 shadow-[var(--shadow-subtle)] space-y-6">
          <div className="space-y-1.5">
            <h1 className="text-[1.75rem] font-medium">Create your account</h1>
            <p className="text-sm text-[var(--neutral-600)]">
              Verify your email to save projects, receive chapter alerts, and export PDFs.
            </p>
          </div>

          <SignUpForm turnstileSiteKey={turnstileSiteKey} />

          <p className="text-sm text-[var(--neutral-600)] border-t border-[var(--neutral-200)] pt-4">
            Already have an account?{" "}
            <Link
              href="/sign-in"
              className="text-[var(--accent-600)] font-medium underline underline-offset-4"
            >
              Sign in
            </Link>
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
