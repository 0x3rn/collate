import { env } from "cloudflare:workers";
import { handleDeleteAccount, type R2DeletableBucket } from "@/lib/account/delete-account";
import { buildWorkerAuthDeps } from "@/lib/auth/route-deps";

export async function POST(request: Request): Promise<Response> {
  return handleDeleteAccount(request, {
    ...buildWorkerAuthDeps(request),
    bucket: env.FILES as unknown as R2DeletableBucket,
  });
}
