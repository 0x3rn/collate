import { env } from "cloudflare:workers";
import type { Metadata } from "next";
import Link from "next/link";
import { DeleteAccountPanel } from "@/components/account/delete-account-panel";
import { NotificationPrefsForm } from "@/components/account/notification-prefs-form";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { WorkspaceShell } from "@/components/layout/workspace-shell";
import { createDb } from "@/db/client";
import { requireUser } from "@/lib/auth/server";
import { getUserNotificationPrefs } from "@/lib/email/notifications";
import { formatCredits, formatShortDate } from "@/lib/ui/formatters";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Account | Collate",
  description: "Manage your profile, email updates, and account settings.",
};

export default async function AccountPage() {
  const user = await requireUser("/account");
  const db = createDb(env.DB);
  const notificationPrefs = await getUserNotificationPrefs(db, user.id);

  return (
    <WorkspaceShell user={user} maxWidthClassName="max-w-[980px]">
      <div className="space-y-2">
        <header className="pb-6 border-b border-[var(--neutral-200)] space-y-1">
          <h1 className="text-[1.75rem] sm:text-[2rem] font-medium leading-tight">Account</h1>
          <p className="text-sm text-[var(--neutral-600)]">
            Manage your profile, email updates, and account settings.
          </p>
        </header>

        <div className="divide-y divide-[var(--neutral-200)]">
          {/* 1. Profile */}
          <section
            aria-label="Profile details"
            className="py-7 grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-8 items-start"
          >
            <div className="lg:col-span-4 space-y-1">
              <h2 className="text-base font-semibold text-[var(--neutral-900)]">Profile</h2>
              <p className="text-sm text-[var(--neutral-600)] leading-relaxed">
                Your name, verified email address, and quick link to credits.
              </p>
            </div>

            <div className="lg:col-span-8 bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] divide-y divide-[var(--neutral-200)]">
              <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-medium text-[var(--neutral-500)]">Full name</p>
                  <p className="text-sm font-medium text-[var(--neutral-900)] mt-1">{user.name}</p>
                </div>
                <p className="text-xs text-[var(--neutral-500)] tabular-nums">
                  Joined {formatShortDate(user.createdAt)}
                </p>
              </div>

              <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-[var(--neutral-500)]">Email address</p>
                  <p className="text-sm text-[var(--neutral-900)] mt-1">{user.email}</p>
                </div>
                <span className="inline-flex items-center px-2.5 py-0.5 text-xs font-medium rounded-[4px] border bg-[var(--success-bg)] text-[var(--success-text)] border-[var(--success-border)] w-fit">
                  Verified
                </span>
              </div>

              <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-[var(--neutral-500)]">Credits</p>
                  <p className="text-sm text-[var(--neutral-900)] mt-1 tabular-nums">
                    {formatCredits(user.creditsBalance)} available
                  </p>
                </div>
                <Link
                  href="/billing"
                  className="text-sm font-medium text-[var(--accent-600)] hover:text-[var(--accent-700)] underline underline-offset-4 w-fit"
                >
                  Manage credits &amp; billing
                </Link>
              </div>
            </div>
          </section>

          {/* 2. Email updates */}
          <section
            aria-label="Email updates"
            className="py-7 grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-8 items-start"
          >
            <div className="lg:col-span-4 space-y-1">
              <h2 className="text-base font-semibold text-[var(--neutral-900)]">Email updates</h2>
              <p className="text-sm text-[var(--neutral-600)] leading-relaxed">
                Choose which project and receipt emails we send to your inbox.
              </p>
            </div>

            <div className="lg:col-span-8">
              <NotificationPrefsForm initialPrefs={notificationPrefs} />
            </div>
          </section>

          {/* 3. Sign out */}
          <section
            aria-label="Sign out"
            className="py-7 grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-8 items-start"
          >
            <div className="lg:col-span-4 space-y-1">
              <h2 className="text-base font-semibold text-[var(--neutral-900)]">Sign out</h2>
              <p className="text-sm text-[var(--neutral-600)] leading-relaxed">
                End your session on this device.
              </p>
            </div>

            <div className="lg:col-span-8 bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <p className="text-sm text-[var(--neutral-700)]">
                Sign out of Collate on this device.
              </p>
              <SignOutButton variant="secondary" />
            </div>
          </section>

          {/* 4. Delete account */}
          <section
            aria-label="Delete account"
            className="py-7 grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-8 items-start"
          >
            <div className="lg:col-span-4 space-y-1">
              <h2 className="text-base font-semibold text-[var(--error-text)]">Delete account</h2>
              <p className="text-sm text-[var(--neutral-600)] leading-relaxed">
                Permanently remove your account, projects, chapters, uploaded files, and exports.
              </p>
            </div>

            <div className="lg:col-span-8">
              <DeleteAccountPanel />
            </div>
          </section>
        </div>
      </div>
    </WorkspaceShell>
  );
}
