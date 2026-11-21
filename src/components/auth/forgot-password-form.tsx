"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { FormAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/field";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    if (!email.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = (await res.json()) as { ok: boolean; message?: string; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "We could not process that request. Try again shortly.");
        return;
      }
      setSuccessMessage(
        data.message ?? "If an account exists for that email, we sent a password reset link."
      );
    } catch {
      setError("Network error while reaching the server. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      {error ? <FormAlert tone="error">{error}</FormAlert> : null}
      {successMessage ? <FormAlert tone="success">{successMessage}</FormAlert> : null}

      <FormField
        id="forgot-email"
        label="Email address"
        type="email"
        name="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        helpText="We will email a single-use reset link valid for 1 hour."
      />

      <Button type="submit" fullWidth loading={submitting} loadingLabel="Sending reset link...">
        Send reset link
      </Button>

      <p className="text-sm text-[var(--neutral-600)]">
        Remembered your password?{" "}
        <Link
          href="/sign-in"
          className="text-[var(--accent-600)] font-medium underline underline-offset-4"
        >
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
