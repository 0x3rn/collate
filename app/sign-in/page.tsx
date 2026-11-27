import { env } from "cloudflare:workers";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignInForm } from "@/components/auth/sign-in-form";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { getCurrentUser } from "@/lib/auth/server";
import { isGoogleSignInEnabled } from "@/lib/auth/route-deps";
import { sanitizeRedirectPath } from "@/lib/auth/tokens";
import { resolveTurnstileSiteKey } from "@/lib/security/turnstile";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in | Collate",
  description: "Sign in to Collate to view your projects and continue writing chapters.",
  robots: { index: false, follow: false },
};

function googleErrorMessage(value: string | string[] | undefined): string | null {
  if (value === "unverified")
    return "Google did not confirm that email address. Try another account.";
  if (value === "rate_limited") return "Too many sign-in attempts. Please wait a few minutes.";
  if (value === "unavailable") return "Google sign-in is not available right now.";
  if (value === "error") return "Google sign-in did not finish. Please try again.";
  return null;
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  const params = await searchParams;
  const rawNext = typeof params.next === "string" ? params.next : undefined;
  const safeNext = sanitizeRedirectPath(rawNext, "/dashboard");

  if (user) {
    redirect(safeNext);
  }

  const turnstileSiteKey = resolveTurnstileSiteKey(
    env as unknown as Record<string, unknown>,
    process.env
  );

  return (
    <>
      <SiteHeader user={null} />
      <main className="flex-1 mx-auto w-full max-w-[420px] px-4 sm:px-0 py-14 sm:py-20">
        <div className="space-y-7">
          <div className="space-y-1.5">
            <h1 className="text-[2rem] font-medium leading-tight">Sign in to Collate</h1>
            <p className="text-sm text-[var(--neutral-600)]">
              Enter your email address and password to open your projects.
            </p>
          </div>

          <SignInForm
            turnstileSiteKey={turnstileSiteKey}
            nextPath={safeNext}
            initialEmail={typeof params.email === "string" ? params.email.slice(0, 200) : ""}
            justVerified={params.verified === "1"}
            googleEnabled={isGoogleSignInEnabled()}
            googleError={googleErrorMessage(params.google)}
          />

          <p className="text-sm text-[var(--neutral-600)] border-t border-[var(--neutral-200)] pt-4">
            New to Collate?{" "}
            <Link
              href="/sign-up"
              className="text-[var(--accent-600)] font-medium underline underline-offset-4"
            >
              Create account
            </Link>
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
