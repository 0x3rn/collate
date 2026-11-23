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
import { formatShortDate } from "@/lib/ui/formatters";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Account — Collate",
  description: "Manage your profile, email updates, and account settings.",
};

export default async function AccountPage() {
  const user = await requireUser("/account");
  const db = createDb(env.DB);
  const notificationPrefs = await getUserNotificationPrefs(db, user.id);

  return (
    <WorkspaceShell user={user} maxWidthClassName="max-w-[820px]">
      <div className="space-y-8">
        <header className="border-b border-[var(--neutral-200)] pb-5 space-y-1">
          <h1 className="text-[1.875rem] sm:text-[2.125rem] font-medium m-0">Account</h1>
          <p className="text-sm sm:text-base text-[var(--neutral-600)] m-0">
            Manage your profile, email updates, and account settings.
          </p>
        </header>

        <section
          aria-label="Profile details"
          className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] divide-y divide-[var(--neutral-200)]"
        >
          <div className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <p className="text-xs font-medium text-[var(--neutral-500)]">Full name</p>
              <p className="text-base font-medium text-[var(--neutral-900)] mt-1">{user.name}</p>
            </div>
            <p className="text-xs text-[var(--neutral-500)] tabular-nums">
              Joined {formatShortDate(user.createdAt)}
            </p>
          </div>

          <div className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-[var(--neutral-500)]">Email address</p>
              <p className="text-base text-[var(--neutral-900)] mt-1">{user.email}</p>
            </div>
            <span className="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-[var(--radius-sm)] border bg-[var(--success-bg)] text-[var(--success-text)] border-[var(--success-border)] w-fit">
              Verified
            </span>
          </div>

          <div className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-[var(--neutral-500)]">Credits</p>
              <p className="text-base text-[var(--neutral-900)] mt-1 tabular-nums">
                {user.creditsBalance} credits available
              </p>
            </div>
            <Link
              href="/billing"
              className="text-sm font-medium text-[var(--accent-600)] hover:text-[var(--accent-700)] underline underline-offset-4 w-fit"
            >
              Manage credits &amp; billing
            </Link>
          </div>

          <div className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-[var(--neutral-900)]">Sign out</p>
              <p className="text-sm text-[var(--neutral-600)] mt-1">
                Sign out of Collate on this device.
              </p>
            </div>
            <SignOutButton variant="secondary" />
          </div>
        </section>

        <NotificationPrefsForm initialPrefs={notificationPrefs} />

        <DeleteAccountPanel />
      </div>
    </WorkspaceShell>
  );
}
