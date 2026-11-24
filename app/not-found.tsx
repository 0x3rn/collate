import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { WorkspaceShell } from "@/components/layout/workspace-shell";
import { LinkButton } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth/server";

export default async function NotFoundPage() {
  const user = await getCurrentUser().catch(() => null);

  const card = (
    <div className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-8 space-y-4">
      <p className="text-sm font-medium text-[var(--neutral-500)] tabular-nums">Error 404</p>
      <h1 className="text-[1.75rem] font-medium">Page not found</h1>
      <p className="text-[var(--neutral-600)] leading-relaxed">
        The page you requested does not exist or may have been moved.
      </p>
      <div className="pt-2">
        <LinkButton href={user ? "/dashboard" : "/"} variant="primary">
          {user ? "Return to dashboard" : "Return home"}
        </LinkButton>
      </div>
    </div>
  );

  if (user) {
    return (
      <WorkspaceShell user={user} maxWidthClassName="max-w-[560px]">
        <div className="py-12 sm:py-16">{card}</div>
      </WorkspaceShell>
    );
  }

  return (
    <>
      <SiteHeader user={null} />
      <main className="flex-1 mx-auto w-full max-w-[560px] px-4 sm:px-6 py-20">{card}</main>
      <SiteFooter />
    </>
  );
}
