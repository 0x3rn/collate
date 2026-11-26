import { env } from "cloudflare:workers";
import type { Metadata } from "next";
import { ExportsLibraryClient } from "@/components/dashboard/exports-library-client";
import { WorkspaceShell } from "@/components/layout/workspace-shell";
import { createDb } from "@/db/client";
import { listExportsForUser, resolveExportSigningSecret } from "@/db/queries/dashboard";
import { requireUser } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Exports | Collate",
  description: "Download saved PDF and Word documents from your Collate projects.",
  robots: { index: false, follow: false },
};

export default async function ExportsPage() {
  const user = await requireUser("/exports");
  const db = createDb(env.DB);
  const runtimeEnv = env as unknown as Record<string, string | undefined>;
  const signingSecret = resolveExportSigningSecret({
    configuredSecret: runtimeEnv.EXPORT_SIGNING_SECRET,
    appEnv: runtimeEnv.APP_ENV,
  });

  const exportsList = await listExportsForUser(db, user.id, { signingSecret });

  return (
    <WorkspaceShell user={user}>
      <div className="space-y-6">
        <header className="space-y-1">
          <h1 className="text-[1.875rem] sm:text-[2.125rem] font-medium">Exports</h1>
          <p className="text-sm sm:text-base text-[var(--neutral-600)]">
            Re-download finished PDF and Word (.docx) files generated across your projects.
          </p>
        </header>

        <ExportsLibraryClient exportsList={exportsList} />
      </div>
    </WorkspaceShell>
  );
}
