"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
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
  {
    key: "emailMarketing",
    label: "News and offers",
    description: "Occasional emails about new features and special offers. Unsubscribe any time.",
  },
];

export function NotificationPrefsForm({ initialPrefs }: { initialPrefs: NotificationPrefs }) {
  const toast = useToast();
  const [prefs, setPrefs] = useState<NotificationPrefs>(initialPrefs);
  const [saving, setSaving] = useState(false);

  function toggle(key: keyof NotificationPrefs) {
    setPrefs((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/account/notifications", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(prefs),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) {
        toast.error(
          data.error ?? "Could not save your email settings. Please try again.",
          "Could not save settings"
        );
        return;
      }
      toast.success("Your email preferences have been updated.", "Email settings saved");
    } catch {
      toast.error(
        "Could not save right now. Check your connection and try again.",
        "Connection error"
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] overflow-hidden">
      <div className="divide-y divide-[var(--neutral-200)]">
        {PREF_ROWS.map((row) => (
          <label
            key={row.key}
            className="px-5 py-4 flex items-start gap-3.5 cursor-pointer hover:bg-[var(--neutral-50)] transition-colors"
          >
            <input
              type="checkbox"
              checked={prefs[row.key]}
              onChange={() => toggle(row.key)}
              className="mt-0.5 w-4 h-4 accent-[var(--accent-600)] shrink-0"
            />
            <div>
              <p className="text-sm font-medium text-[var(--neutral-900)]">{row.label}</p>
              <p className="text-xs text-[var(--neutral-600)] mt-0.5">{row.description}</p>
            </div>
          </label>
        ))}
      </div>

      <div className="px-5 py-3.5 bg-[var(--neutral-50)] border-t border-[var(--neutral-200)] flex justify-end">
        <Button type="button" loading={saving} loadingLabel="Saving..." onClick={handleSave}>
          Save email settings
        </Button>
      </div>
    </div>
  );
}
