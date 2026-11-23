import { env } from "cloudflare:workers";
import type { ReactNode } from "react";
import type { PublicUser } from "@/lib/auth/service";
import { isAdminEmail } from "@/lib/billing/http-handlers";
import { AppShell } from "./app-shell";

export function WorkspaceShell({
  user,
  children,
  maxWidthClassName,
}: {
  user: PublicUser;
  children: ReactNode;
  maxWidthClassName?: string;
}) {
  const runtimeEnv = env as unknown as Record<string, string | undefined>;
  const isAdmin = isAdminEmail(user.email, runtimeEnv.ADMIN_EMAILS);

  return (
    <AppShell
      user={{
        name: user.name,
        email: user.email,
        creditsBalance: user.creditsBalance,
        isAdmin,
      }}
      maxWidthClassName={maxWidthClassName}
    >
      {children}
    </AppShell>
  );
}
