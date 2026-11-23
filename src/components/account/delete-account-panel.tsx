"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { FormAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/field";

export function DeleteAccountPanel() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (confirmation.trim() !== "DELETE MY ACCOUNT") {
      setError('Type "DELETE MY ACCOUNT" exactly to confirm.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password, confirmation: confirmation.trim() }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setError(json.error ?? "Could not delete your account. Check your password and try again.");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("Could not delete your account right now. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="bg-white border border-[var(--error-border)] rounded-[var(--radius-md)] p-6 space-y-4">
      <div className="space-y-1">
        <h2 className="text-xl font-medium text-[var(--error-text)] m-0">Delete account</h2>
        <p className="text-sm text-[var(--neutral-600)] m-0">
          Permanently deletes your account, projects, chapters, uploaded files, and saved exports.
          This cannot be undone.
        </p>
      </div>

      {error ? <FormAlert tone="error">{error}</FormAlert> : null}

      <form onSubmit={handleSubmit} noValidate className="space-y-4 max-w-[480px]">
        <FormField
          id="delete-password"
          label="Your password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <FormField
          id="delete-confirm-phrase"
          label='Type "DELETE MY ACCOUNT" to confirm'
          type="text"
          required
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
        />
        <Button
          type="submit"
          variant="secondary"
          loading={submitting}
          loadingLabel="Deleting account..."
          className="border-[var(--error-border)] text-[var(--error-text)] hover:bg-[var(--error-bg)]"
        >
          Delete my account
        </Button>
      </form>
    </section>
  );
}
