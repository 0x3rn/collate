"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { FormAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/field";
import { TurnstileWidget } from "@/components/ui/turnstile-widget";

export function SignInForm({
  turnstileSiteKey,
  nextPath,
}: {
  turnstileSiteKey: string;
  nextPath: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsVerification, setNeedsVerification] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setNeedsVerification(false);

    if (!email.trim() || !password) {
      setError("Enter both your email address and password.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/signin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          password,
          turnstileToken: turnstileToken || undefined,
        }),
      });
      const data = (await res.json()) as { ok: boolean; code?: string; error?: string };
      if (!res.ok || !data.ok) {
        if (data.code === "EMAIL_NOT_VERIFIED") {
          setNeedsVerification(true);
        }
        setError(data.error ?? "Invalid email or password.");
        return;
      }

      router.push(nextPath);
      router.refresh();
    } catch {
      setError("Network error while reaching the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      {error ? (
        <FormAlert tone="error">
          {error}{" "}
          {needsVerification ? (
            <Link href="/verify-email" className="underline font-medium">
              Request a new verification link
            </Link>
          ) : null}
        </FormAlert>
      ) : null}

      <FormField
        id="signin-email"
        label="Email address"
        type="email"
        name="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      <div className="space-y-1.5">
        <FormField
          id="signin-password"
          label="Password"
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <div className="text-right">
          <Link
            href="/forgot-password"
            className="text-sm text-[var(--accent-600)] hover:underline underline-offset-4"
          >
            Forgot password?
          </Link>
        </div>
      </div>

      <TurnstileWidget siteKey={turnstileSiteKey} onTokenChange={setTurnstileToken} />

      <div className="pt-2">
        <Button type="submit" fullWidth loading={submitting} loadingLabel="Signing in...">
          Sign in
        </Button>
      </div>
    </form>
  );
}
