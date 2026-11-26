import type { Metadata } from "next";
import { env } from "cloudflare:workers";
import { AdminInboxClient } from "@/components/admin/admin-inbox-client";
import { WorkspaceShell } from "@/components/layout/workspace-shell";
import { FormAlert } from "@/components/ui/alert";
import { LinkButton } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/server";
import { isAdminEmail } from "@/lib/billing/http-handlers";
import { readMailboxConfig } from "@/lib/inbox/config";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Email | Collate admin",
  description: "Support, billing and general email, announcements and promotions.",
};

export default async function AdminInboxPage() {
  const user = await requireUser("/admin/inbox");
  const runtimeEnv = env as unknown as Record<string, unknown>;
  const adminEmails =
    typeof runtimeEnv.ADMIN_EMAILS === "string" ? runtimeEnv.ADMIN_EMAILS : undefined;

  if (!user.emailVerified || !isAdminEmail(user.email, adminEmails)) {
    return (
      <WorkspaceShell user={user} maxWidthClassName="max-w-[600px]">
        <div className="py-8 space-y-5">
          <FormAlert tone="error">Admin access required.</FormAlert>
          <LinkButton href="/dashboard" variant="secondary">
            Back to overview
          </LinkButton>
        </div>
      </WorkspaceShell>
    );
  }

  const mailboxes = readMailboxConfig(runtimeEnv);
  return (
    <WorkspaceShell user={user} maxWidthClassName="max-w-[1180px]">
      <div className="space-y-6">
        <div className="border-b border-[var(--neutral-200)] pb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[2rem] font-medium">Email</h1>
            <p className="text-sm text-[var(--neutral-600)] mt-1.5">
              Read and answer email, and send announcements and promotions.
            </p>
          </div>
          <LinkButton href="/admin" variant="secondary">
            Admin overview
          </LinkButton>
        </div>
        <AdminInboxClient
          addresses={{
            support: mailboxes.support,
            billing: mailboxes.billing,
            general: mailboxes.general,
            announcement: `Sent from ${mailboxes.announcements}`,
            promotion: `Sent from ${mailboxes.promotions}`,
          }}
        />
      </div>
    </WorkspaceShell>
  );
}
