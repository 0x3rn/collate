"use client";

import { useState } from "react";
import { FormAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { NotificationPrefs } from "@/lib/email/notifications";

const PREF_ROWS: Array<{ key: keyof NotificationPrefs; label: string; description: string }> = [
  {
    key: "emailChapterReady",
    label: "Chapter ready",
    description: "Send me an email with a direct link when a chapter finishes drafting.",
  },
  {
    key: "emailNeedsAttention",
    label: "Needs your review",
    description: "Send me an email if a chapter pauses and needs my input before continuing.",
  },
  {
    key: "emailProjectComplete",
    label: "Project finished",
    description: "Send me an email when every chapter is ready for PDF and Word download.",
  },
  {
    key: "emailReceipts",
    label: "Receipts and refunds",
    description: "Send me a receipt when I buy credits or receive an automatic refund.",
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
        setError(data.error ?? "Could not save your email settings. Please try again.");
        return;
      }
      setSavedNotice("Email settings saved.");
    } catch {
      setError("Could not save right now. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-6 space-y-5">
      <div className="space-y-1">
        <h2 className="text-xl font-medium m-0">Email updates</h2>
        <p className="text-sm text-[var(--neutral-600)] m-0">
          Choose which project and receipt emails we send to your inbox.
        </p>
      </div>

      {error ? <FormAlert tone="error">{error}</FormAlert> : null}
      {savedNotice ? <FormAlert tone="success">{savedNotice}</FormAlert> : null}

      <div className="space-y-3">
        {PREF_ROWS.map((row) => (
          <label
            key={row.key}
            className="flex items-start gap-3 p-3.5 rounded-[var(--radius-sm)] border border-[var(--neutral-200)] bg-[var(--neutral-50)] cursor-pointer hover:border-[var(--neutral-300)] transition-colors"
          >
            <input
              type="checkbox"
              checked={prefs[row.key]}
              onChange={() => toggle(row.key)}
              className="mt-1 w-4 h-4 accent-[var(--accent-600)]"
            />
            <div>
              <p className="text-sm font-medium text-[var(--neutral-900)]">{row.label}</p>
              <p className="text-xs text-[var(--neutral-600)] mt-1">{row.description}</p>
            </div>
          </label>
        ))}
      </div>

      <div className="flex justify-end">
        <Button type="button" loading={saving} loadingLabel="Saving..." onClick={handleSave}>
          Save email settings
        </Button>
      </div>
    </section>
  );
}
