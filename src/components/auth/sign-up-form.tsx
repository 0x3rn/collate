"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { FormAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/field";
import { TurnstileWidget } from "@/components/ui/turnstile-widget";

export function SignUpForm({ turnstileSiteKey }: { turnstileSiteKey: string }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [touched, setTouched] = useState<{ name?: boolean; email?: boolean; password?: boolean }>(
    {}
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const nameError =
    touched.name && name.trim().length < 2
      ? "Enter your full name (at least 2 characters)."
      : undefined;
  const emailError =
    touched.email && !email.includes("@")
      ? "Enter a valid email address with an @ symbol."
      : undefined;
  const passwordError =
    touched.password && password.length < 12
      ? "Use at least 12 characters for your password."
      : undefined;

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setTouched({ name: true, email: true, password: true });
    setError(null);

    if (name.trim().length < 2 || !email.includes("@") || password.length < 12) {
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          password,
          turnstileToken: turnstileToken || undefined,
        }),
      });
      const data = (await res.json()) as { ok: boolean; message?: string; error?: string };
      if (!res.ok || !data.ok) {
        setError(
          data.error ?? "We could not create your account. Check your details and try again."
        );
        return;
      }
      setSuccessMessage(
        data.message ?? "Check your inbox for a verification link to activate your account."
      );
      setPassword("");
    } catch {
      setError("Network error while reaching the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (successMessage) {
    return (
      <div className="space-y-4">
        <FormAlert tone="success">{successMessage}</FormAlert>
        <p className="text-sm text-[var(--neutral-600)]">
          Open the link in your email to verify your address before signing in.
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <Link
            href="/sign-in"
            className="text-sm font-medium text-[var(--accent-600)] underline underline-offset-4"
          >
            Go to sign in
          </Link>
          <Link
            href="/verify-email"
            className="text-sm font-medium text-[var(--neutral-700)] underline underline-offset-4"
          >
            Resend verification link
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      {error ? <FormAlert tone="error">{error}</FormAlert> : null}

      <FormField
        id="signup-name"
        label="Full name"
        type="text"
        name="name"
        autoComplete="name"
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => setTouched((prev) => ({ ...prev, name: true }))}
        error={nameError}
      />

      <FormField
        id="signup-email"
        label="Email address"
        type="email"
        name="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        onBlur={() => setTouched((prev) => ({ ...prev, email: true }))}
        helpText="We send chapter completion updates and verification links here."
        error={emailError}
      />

      <FormField
        id="signup-password"
        label="Password"
        type="password"
        name="password"
        autoComplete="new-password"
        required
        minLength={12}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onBlur={() => setTouched((prev) => ({ ...prev, password: true }))}
        helpText="Use at least 12 characters. A four-word passphrase works well."
        error={passwordError}
      />

      <TurnstileWidget siteKey={turnstileSiteKey} onTokenChange={setTurnstileToken} />

      <div className="pt-2">
        <Button type="submit" fullWidth loading={submitting} loadingLabel="Creating account...">
          Create account
        </Button>
      </div>

      <p className="text-xs text-[var(--neutral-600)] leading-relaxed">
        By creating an account, you agree to the{" "}
        <Link href="/terms" className="underline underline-offset-2 text-[var(--neutral-800)]">
          Terms of service
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className="underline underline-offset-2 text-[var(--neutral-800)]">
          Privacy policy
        </Link>
        .
      </p>
    </form>
  );
}
