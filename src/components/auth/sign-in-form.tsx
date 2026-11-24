"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/field";
import { ModalCard } from "@/components/ui/modal-card";
import { useToast } from "@/components/ui/toast";
import { TurnstileWidget } from "@/components/ui/turnstile-widget";

export function SignInForm({
  turnstileSiteKey,
  nextPath,
}: {
  turnstileSiteKey: string;
  nextPath: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const [resendingLink, setResendingLink] = useState(false);

  async function handleResendVerification() {
    if (!unverifiedEmail) return;
    setResendingLink(true);
    try {
      const res = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: unverifiedEmail }),
      });
      const data = (await res.json()) as { ok: boolean; message?: string; error?: string };
      if (!res.ok || !data.ok) {
        toast.error(
          data.error ?? "Could not send a verification link. Try again shortly.",
          "Could not send email"
        );
        return;
      }
      setUnverifiedEmail(null);
      toast.success(
        data.message ?? "We sent a fresh verification link to your inbox.",
        "Verification email sent"
      );
    } catch {
      toast.error("Network error while sending the verification link.", "Connection error");
    } finally {
      setResendingLink(false);
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!email.trim() || !password) {
      toast.error("Enter both your email address and password.", "Missing credentials");
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
          setUnverifiedEmail(email.trim());
          return;
        }
        toast.error(data.error ?? "Invalid email or password.", "Could not sign in");
        return;
      }

      router.push(nextPath);
      router.refresh();
    } catch {
      toast.error(
        "Network error while reaching the server. Check your connection and try again.",
        "Connection error"
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
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

      <ModalCard
        open={Boolean(unverifiedEmail)}
        onClose={() => setUnverifiedEmail(null)}
        eyebrow="Email verification"
        title="Verify your email to sign in"
        maxWidthClassName="max-w-[440px]"
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setUnverifiedEmail(null)}>
              Close
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={resendingLink}
              loadingLabel="Sending link..."
              onClick={handleResendVerification}
            >
              Resend verification email
            </Button>
          </>
        }
      >
        <p className="text-sm text-[var(--neutral-700)] leading-relaxed m-0">
          Your account for{" "}
          <strong className="font-semibold text-[var(--neutral-900)]">{unverifiedEmail}</strong> has
          not been verified yet. Open the verification link we sent to your inbox, or request a
          fresh link below.
        </p>
      </ModalCard>
    </>
  );
}
