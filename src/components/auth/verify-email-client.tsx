"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { FormAlert } from "@/components/ui/alert";
import { Button, LinkButton } from "@/components/ui/button";
import { FormField } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { VerifyCodePanel } from "./verify-code-panel";

export function VerifyEmailClient({ token }: { token: string | null }) {
  const toast = useToast();
  const [status, setStatus] = useState<"idle" | "verifying" | "verified" | "error">(
    token ? "verifying" : "idle"
  );
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [email, setEmail] = useState("");
  const [resending, setResending] = useState(false);
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
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
          const message = data.error ?? "This verification link is invalid or has expired.";
          setStatus("error");
          setStatusMessage(message);
          toast.error(message, "Verification failed");
        }
      } catch {
        const message = "Could not verify your email right now. Try again shortly.";
        setStatus("error");
        setStatusMessage(message);
        toast.error(message, "Connection error");
      }
    }

    void verify();
  }, [token, toast]);

  async function handleResend(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!email.includes("@")) {
      toast.error("Enter a valid email address.", "Invalid email");
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
        toast.error(
          data.error ?? "Could not send a verification link. Try again.",
          "Could not send link"
        );
        return;
      }
      setCodeSentTo(email.trim().toLowerCase());
    } catch {
      toast.error("Network error. Check your connection and try again.", "Connection error");
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

  if (codeSentTo) {
    return (
      <VerifyCodePanel
        email={codeSentTo}
        intro="We sent a new verification email. Enter the 6-digit code we sent to"
        onVerified={() => {
          setStatus("verified");
          setStatusMessage("Your email is verified. You can sign in now.");
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleResend} noValidate className="space-y-4">
        <p className="text-sm text-[var(--neutral-600)]">
          Need a new code? Enter the email you used when creating your account.
        </p>

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
        <Button type="submit" fullWidth loading={resending} loadingLabel="Sending...">
          Send verification code
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
