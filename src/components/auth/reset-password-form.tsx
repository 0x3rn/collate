"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { FormAlert } from "@/components/ui/alert";
import { Button, LinkButton } from "@/components/ui/button";
import { FormField } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";

export function ResetPasswordForm({ token }: { token: string | null }) {
  const toast = useToast();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [doneMessage, setDoneMessage] = useState<string | null>(null);

  if (!token) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-[var(--neutral-700)] leading-relaxed">
          This password reset link is missing its token or is no longer valid. Request a fresh link
          to continue.
        </p>
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

    if (newPassword.length < 12) {
      toast.error("Use at least 12 characters for your new password.", "Password too short");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("The two password fields do not match.", "Passwords do not match");
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
        toast.error(data.error ?? "This reset link is invalid or expired.", "Reset link invalid");
        return;
      }
      setDoneMessage(data.message ?? "Your password has been updated.");
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      toast.error("Network error while updating your password. Try again.", "Connection error");
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
