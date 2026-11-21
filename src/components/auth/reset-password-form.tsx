"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { FormAlert } from "@/components/ui/alert";
import { Button, LinkButton } from "@/components/ui/button";
import { FormField } from "@/components/ui/field";

export function ResetPasswordForm({ token }: { token: string | null }) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneMessage, setDoneMessage] = useState<string | null>(null);

  if (!token) {
    return (
      <div className="space-y-4">
        <FormAlert tone="error">
          This password reset link is missing its token. Request a new link to continue.
        </FormAlert>
        <Link
          href="/forgot-password"
          className="text-sm font-medium text-[var(--accent-600)] underline underline-offset-4"
        >
          Request a new password reset link
        </Link>
      </div>
    );
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 12) {
      setError("Use at least 12 characters for your new password.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("The two password fields do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, newPassword }),
      });
      const data = (await res.json()) as { ok: boolean; message?: string; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "This reset link is invalid or expired.");
        return;
      }
      setDoneMessage(data.message ?? "Your password has been updated.");
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      setError("Network error while updating your password. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (doneMessage) {
    return (
      <div className="space-y-5">
        <FormAlert tone="success">{doneMessage}</FormAlert>
        <LinkButton href="/sign-in" fullWidth>
          Sign in with your new password
        </LinkButton>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      {error ? <FormAlert tone="error">{error}</FormAlert> : null}

      <FormField
        id="reset-new-password"
        label="New password"
        type="password"
        name="newPassword"
        autoComplete="new-password"
        required
        minLength={12}
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
        helpText="At least 12 characters. Existing sessions on other devices will be signed out."
      />

      <FormField
        id="reset-confirm-password"
        label="Confirm new password"
        type="password"
        name="confirmPassword"
        autoComplete="new-password"
        required
        minLength={12}
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
      />

      <Button type="submit" fullWidth loading={submitting} loadingLabel="Updating password...">
        Update password
      </Button>
    </form>
  );
}
