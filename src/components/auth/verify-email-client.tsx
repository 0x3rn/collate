"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { FormAlert } from "@/components/ui/alert";
import { Button, LinkButton } from "@/components/ui/button";
import { FormField } from "@/components/ui/field";

export function VerifyEmailClient({ token }: { token: string | null }) {
  const [status, setStatus] = useState<"idle" | "verifying" | "verified" | "error">(
    token ? "verifying" : "idle"
  );
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [email, setEmail] = useState("");
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);
  const didSubmitRef = useRef(false);

  useEffect(() => {
    if (!token || didSubmitRef.current) return;
    didSubmitRef.current = true;

    async function verify() {
      try {
        const res = await fetch("/api/auth/verify-email", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = (await res.json()) as { ok: boolean; message?: string; error?: string };
        if (res.ok && data.ok) {
          setStatus("verified");
          setStatusMessage(data.message ?? "Your email address is verified.");
        } else {
          setStatus("error");
          setStatusMessage(data.error ?? "This verification link is invalid or has expired.");
        }
      } catch {
        setStatus("error");
        setStatusMessage("Could not verify your email right now. Try again shortly.");
      }
    }

    void verify();
  }, [token]);

  async function handleResend(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setResendError(null);
    setResendMessage(null);

    if (!email.includes("@")) {
      setResendError("Enter a valid email address.");
      return;
    }

    setResending(true);
    try {
      const res = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = (await res.json()) as { ok: boolean; message?: string; error?: string };
      if (!res.ok || !data.ok) {
        setResendError(data.error ?? "Could not send a verification link. Try again.");
        return;
      }
      setResendMessage(
        data.message ?? "If that email belongs to an unverified account, we sent a new link."
      );
    } catch {
      setResendError("Network error. Check your connection and try again.");
    } finally {
      setResending(false);
    }
  }

  if (status === "verifying") {
    return <FormAlert tone="info">Checking your verification link...</FormAlert>;
  }

  if (status === "verified") {
    return (
      <div className="space-y-5">
        <FormAlert tone="success">{statusMessage}</FormAlert>
        <LinkButton href="/sign-in" fullWidth>
          Sign in to your account
        </LinkButton>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {status === "error" ? <FormAlert tone="error">{statusMessage}</FormAlert> : null}

      <form onSubmit={handleResend} noValidate className="space-y-4">
        <p className="text-sm text-[var(--neutral-600)]">
          Need a fresh link? Enter the email you used when creating your account.
        </p>
        {resendError ? <FormAlert tone="error">{resendError}</FormAlert> : null}
        {resendMessage ? <FormAlert tone="success">{resendMessage}</FormAlert> : null}

        <FormField
          id="resend-email"
          label="Email address"
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Button type="submit" fullWidth loading={resending} loadingLabel="Sending link...">
          Send verification link
        </Button>
      </form>

      <p className="text-sm text-[var(--neutral-600)]">
        Already verified?{" "}
        <Link
          href="/sign-in"
          className="text-[var(--accent-600)] font-medium underline underline-offset-4"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
