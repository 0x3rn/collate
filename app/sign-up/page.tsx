import { env } from "cloudflare:workers";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { FormAlert } from "@/components/ui/alert";
import { isGoogleSignInEnabled } from "@/lib/auth/route-deps";
import { getCurrentUser } from "@/lib/auth/server";
import { resolveTurnstileSiteKey } from "@/lib/security/turnstile";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Create account | Collate",
  description: "Create a Collate account to start checking topics and drafting chapters.",
  robots: { index: false, follow: false },
};

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string }>;
}) {
  const { google } = await searchParams;
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
      <main className="flex-1 w-full flex items-center justify-center px-4 sm:px-6 py-10 sm:py-16">
        <div className="w-full max-w-[460px] bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-6 sm:p-8 shadow-[var(--shadow-subtle)] space-y-6">
          <div className="space-y-1.5">
            <h1 className="text-[1.875rem] sm:text-[2rem] font-medium leading-tight">
              Create your account
            </h1>
            <p className="text-sm text-[var(--neutral-600)]">
              Verify your email to save projects, receive chapter alerts, and export PDFs.
            </p>
          </div>

          {google === "terms" ? (
            <FormAlert tone="info">
              There is no Collate account for that Google address yet. Tick the box below to agree
              to the Terms, then choose Sign up with Google.
            </FormAlert>
          ) : null}

          <SignUpForm turnstileSiteKey={turnstileSiteKey} googleEnabled={isGoogleSignInEnabled()} />

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
