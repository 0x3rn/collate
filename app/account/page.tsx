import { env } from "cloudflare:workers";
import type { Metadata } from "next";
import Link from "next/link";
import { DeleteAccountPanel } from "@/components/account/delete-account-panel";
import { ExportDataButton } from "@/components/account/export-data-button";
import { NotificationPrefsForm } from "@/components/account/notification-prefs-form";
import {
  ActiveSessions,
  ChangeEmailButton,
  ChangePasswordButton,
  NameRow,
} from "@/components/account/account-security";
import { WorkspaceShell } from "@/components/layout/workspace-shell";
import { and, eq } from "drizzle-orm";
import { createDb } from "@/db/client";
import { accounts } from "@/db/schema";
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
  const [credential] = await db
    .select({ password: accounts.password })
    .from(accounts)
    .where(and(eq(accounts.userId, user.id), eq(accounts.providerId, "credential")))
    .limit(1);
  const hasPassword = Boolean(credential?.password);

  return (
    <WorkspaceShell user={user} maxWidthClassName="max-w-[980px]">
      <div className="space-y-2">
        <header className="pb-6 border-b border-[var(--neutral-200)] space-y-1">
          <h1 className="text-[1.75rem] sm:text-[2rem] font-medium leading-tight">Account</h1>
          <p className="text-sm text-[var(--neutral-600)]">
            Manage your profile, email updates, and account settings. Member since{" "}
            {formatShortDate(user.createdAt)}.
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
              <div className="px-5 py-4">
                <NameRow initialName={user.name} />
              </div>
              <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-[var(--neutral-500)]">Email address</p>
                  <p className="text-sm text-[var(--neutral-900)] mt-1 break-all">{user.email}</p>
                </div>
                <ChangeEmailButton currentEmail={user.email} />
              </div>
              <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-[var(--neutral-500)]">Password</p>
                  {hasPassword ? (
                    <p
                      className="text-sm text-[var(--neutral-900)] mt-1 tracking-[0.2em]"
                      aria-label="Password saved"
                    >
                      ••••••••••
                    </p>
                  ) : (
                    <p className="text-sm text-[var(--neutral-500)] mt-1">Not set</p>
                  )}
                </div>
                <ChangePasswordButton email={user.email} hasPassword={hasPassword} />
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

          {/* 3. Active sessions */}
          <section
            aria-label="Active sessions"
            className="py-7 grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-8 items-start"
          >
            <div className="lg:col-span-4 space-y-1">
              <h2 className="text-base font-semibold text-[var(--neutral-900)]">Active sessions</h2>
              <p className="text-sm text-[var(--neutral-600)] leading-relaxed">
                The devices where you are signed in to Collate. Sign out of any you do not
                recognise.
              </p>
            </div>
            <div className="lg:col-span-8">
              <ActiveSessions />
            </div>
          </section>

          {/* 4. Export my data */}
          <section
            aria-label="Export my data"
            className="py-7 grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-8 items-start"
          >
            <div className="lg:col-span-4 space-y-1">
              <h2 className="text-base font-semibold text-[var(--neutral-900)]">Export my data</h2>
              <p className="text-sm text-[var(--neutral-600)] leading-relaxed">
                Download a PDF of your account, payments, credit history, projects, downloads, and
                sign-ins.
              </p>
            </div>
            <div className="lg:col-span-8">
              <ExportDataButton />
            </div>
          </section>

          {/* 5. Delete account */}
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
              <DeleteAccountPanel hasPassword={hasPassword} />
            </div>
          </section>
        </div>
      </div>
    </WorkspaceShell>
  );
}
