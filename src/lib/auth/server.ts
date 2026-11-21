import "server-only";
import { env } from "cloudflare:workers";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createDb } from "@/db/client";
import { listProjectsForUser } from "@/db/queries/projects";
import type { ProjectRecord } from "@/db/schema";
import { DEV_SESSION_COOKIE, PROD_SESSION_COOKIE } from "./cookies";
import { getSessionFromToken, type PublicUser } from "./service";
import { sanitizeRedirectPath } from "./tokens";

/**
 * Server-only Data Access Layer (security-nextjs Rule 2.2).
 * Every protected page and server data read verifies the session directly here.
 */
export const getCurrentSession = cache(
  async (): Promise<{ sessionId: string; user: PublicUser } | null> => {
    const cookieStore = await cookies();
    const runtimeEnv = env as unknown as Record<string, string | undefined>;
    const isProd = (runtimeEnv.APP_ENV?.trim() || "dev") === "prod";

    const rawToken = isProd
      ? cookieStore.get(PROD_SESSION_COOKIE)?.value
      : (cookieStore.get(DEV_SESSION_COOKIE)?.value ?? cookieStore.get(PROD_SESSION_COOKIE)?.value);

    if (!rawToken) return null;

    const db = createDb(env.DB);
    return getSessionFromToken(db, rawToken);
  }
);

export async function getCurrentUser(): Promise<PublicUser | null> {
  const session = await getCurrentSession();
  return session?.user ?? null;
}

export async function requireUser(returnTo = "/dashboard"): Promise<PublicUser> {
  const user = await getCurrentUser();
  if (!user) {
    const safeNext = sanitizeRedirectPath(returnTo, "/dashboard");
    redirect(`/sign-in?next=${encodeURIComponent(safeNext)}`);
  }
  return user;
}

export async function listCurrentUserProjects(): Promise<ProjectRecord[]> {
  const user = await requireUser("/dashboard");
  const db = createDb(env.DB);
  return listProjectsForUser(db, user.id);
}
