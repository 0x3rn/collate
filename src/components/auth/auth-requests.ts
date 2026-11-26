/** Small JSON POST helper for the auth and account screens. Never throws. */
export async function postJson<T extends Record<string, unknown> = Record<string, unknown>>(
  url: string,
  body: unknown
): Promise<{ ok: boolean; status: number; data: T & { error?: string; message?: string } }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const data = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
    return { ok: res.ok && data.ok !== false, status: res.status, data };
  } catch {
    return {
      ok: false,
      status: 0,
      data: {
        error: "Network error. Check your connection and try again.",
      } as T & { error?: string },
    };
  }
}

/** Seconds left before "Resend code" works again. */
export const RESEND_COOLDOWN_SECONDS = 30;
