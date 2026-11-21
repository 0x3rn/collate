import type { Metadata } from "next";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { requireUser } from "@/lib/auth/server";
import { formatShortDate } from "@/lib/ui/formatters";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Account — Collate",
  description: "Manage your Collate account details and session.",
};

export default async function AccountPage() {
  const user = await requireUser("/account");

  return (
    <>
      <SiteHeader user={user} />
      <main className="flex-1 mx-auto w-full max-w-[720px] px-4 sm:px-6 py-10 sm:py-12">
        <div className="border-b border-[var(--neutral-200)] pb-5 mb-8">
          <h1 className="text-[2rem] font-medium">Account</h1>
          <p className="text-sm text-[var(--neutral-600)] mt-1">
            Your profile, email verification status, and active session controls.
          </p>
        </div>

        <section className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] divide-y divide-[var(--neutral-200)]">
          <div className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-[var(--neutral-600)]">Full name</p>
              <p className="text-base text-[var(--neutral-900)] mt-0.5">{user.name}</p>
            </div>
          </div>

          <div className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-[var(--neutral-600)]">Email address</p>
              <p className="text-base text-[var(--neutral-900)] mt-0.5">{user.email}</p>
            </div>
            <span className="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-[var(--radius-sm)] border bg-[var(--success-bg)] text-[var(--success-text)] border-[var(--success-border)] w-fit">
              Verified
            </span>
          </div>

          <div className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-[var(--neutral-600)]">Credits balance</p>
              <p className="text-base text-[var(--neutral-900)] mt-0.5 tabular-nums">
                {user.creditsBalance} credits
              </p>
            </div>
            <p className="text-sm text-[var(--neutral-600)] tabular-nums">
              Member since {formatShortDate(user.createdAt)}
            </p>
          </div>

          <div className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-[var(--neutral-900)]">Current session</p>
              <p className="text-sm text-[var(--neutral-600)]">
                Signing out revokes your session token on the server immediately.
              </p>
            </div>
            <SignOutButton variant="secondary" />
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
