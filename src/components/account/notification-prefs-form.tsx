"use client";

import { useState } from "react";
import { FormAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { NotificationPrefs } from "@/lib/email/notifications";

const PREF_ROWS: Array<{ key: keyof NotificationPrefs; label: string; description: string }> = [
  {
    key: "emailChapterReady",
    label: "Chapter ready alerts",
    description: "Email me with a direct link whenever a chapter finishes drafting.",
  },
  {
    key: "emailNeedsAttention",
    label: "Needs attention alerts",
    description: "Email me if a chapter pauses due to originality checks, timeouts, or errors.",
  },
  {
    key: "emailProjectComplete",
    label: "Project completion alerts",
    description: "Email me when all chapters are ready for full PDF and Word export.",
  },
  {
    key: "emailReceipts",
    label: "Payment and credit receipts",
    description: "Email me confirmation receipts whenever credits are purchased or refunded.",
  },
];

export function NotificationPrefsForm({ initialPrefs }: { initialPrefs: NotificationPrefs }) {
  const [prefs, setPrefs] = useState<NotificationPrefs>(initialPrefs);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggle(key: keyof NotificationPrefs) {
    setPrefs((prev) => ({ ...prev, [key]: !prev[key] }));
    setSavedNotice(null);
  }

  async function handleSave() {
    setError(null);
    setSavedNotice(null);
    setSaving(true);
    try {
      const res = await fetch("/api/account/notifications", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(prefs),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Could not save notification preferences.");
        return;
      }
      setSavedNotice("Email notification preferences saved.");
    } catch {
      setError("Network error while saving preferences.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-6 space-y-5">
      <div className="space-y-1">
        <h2 className="text-xl font-medium m-0">Email notifications</h2>
        <p className="text-sm text-[var(--neutral-600)] m-0">
          Choose which chapter and account emails Collate sends to your verified address.
        </p>
      </div>

      {error ? <FormAlert tone="error">{error}</FormAlert> : null}
      {savedNotice ? <FormAlert tone="success">{savedNotice}</FormAlert> : null}

      <div className="space-y-3">
        {PREF_ROWS.map((row) => (
          <label
            key={row.key}
            className="flex items-start gap-3 p-3.5 rounded-[var(--radius-sm)] border border-[var(--neutral-200)] bg-[var(--neutral-50)] cursor-pointer"
          >
            <input
              type="checkbox"
              checked={prefs[row.key]}
              onChange={() => toggle(row.key)}
              className="mt-1 w-4 h-4 accent-[var(--accent-600)]"
            />
            <div>
              <p className="text-sm font-medium text-[var(--neutral-900)] m-0">{row.label}</p>
              <p className="text-xs text-[var(--neutral-600)] m-0">{row.description}</p>
            </div>
          </label>
        ))}
      </div>

      <div className="flex justify-end">
        <Button type="button" loading={saving} loadingLabel="Saving..." onClick={handleSave}>
          Save preferences
        </Button>
      </div>
    </section>
  );
}
