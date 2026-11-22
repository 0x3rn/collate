import { buildWorkerAuthDeps } from "@/lib/auth/route-deps";
import {
  handleGetNotificationPrefs,
  handleUpdateNotificationPrefs,
} from "@/lib/email/prefs-handlers";

export async function GET(request: Request): Promise<Response> {
  return handleGetNotificationPrefs(request, buildWorkerAuthDeps(request));
}

export async function PUT(request: Request): Promise<Response> {
  return handleUpdateNotificationPrefs(request, buildWorkerAuthDeps(request));
}
