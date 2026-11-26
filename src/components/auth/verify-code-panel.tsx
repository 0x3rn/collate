"use client";

import { useCallback, useEffect, useState } from "react";
import { FormAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { postJson, RESEND_COOLDOWN_SECONDS } from "./auth-requests";
import { CodeInput } from "./code-input";

/**
 * Enter the 6-digit code from the verification email. "Resend code" sends a new code on the
 * spot (the old one stops working) with a short cooldown.
 */
export function VerifyCodePanel({
  email,
  intro,
  onVerified,
}: {
  email: string;
  intro?: string;
  onVerified: () => void;
}) {
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const verify = useCallback(
    async (value: string) => {
      if (value.length !== 6 || submitting) return;
      setSubmitting(true);
      setError(null);
      const res = await postJson("/api/auth/verify-code", { email, code: value });
      setSubmitting(false);
      if (res.ok) {
        onVerified();
        return;
      }
      setError(res.data.error ?? "That code is not right.");
      setCode("");
    },
    [email, onVerified, submitting]
  );

  async function resend() {
    setNotice(null);
    setError(null);
    setCooldown(RESEND_COOLDOWN_SECONDS);
    const res = await postJson("/api/auth/resend-verification", { email });
    if (res.ok) setNotice("We sent a new code. The previous code no longer works.");
    else setError(res.data.error ?? "We could not send a new code. Try again shortly.");
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-[var(--neutral-700)] leading-relaxed">
        {intro ?? "Enter the 6-digit code we sent to"}{" "}
        <strong className="font-semibold text-[var(--neutral-900)] [overflow-wrap:anywhere]">
          {email}
        </strong>
        . It expires in 10 minutes.
      </p>

      <CodeInput
        id="verify-code"
        value={code}
        onChange={(v) => {
          setCode(v);
          if (error) setError(null);
        }}
        onComplete={verify}
        invalid={Boolean(error)}
        disabled={submitting}
      />

      {error ? <FormAlert tone="error">{error}</FormAlert> : null}
      {notice ? <FormAlert tone="success">{notice}</FormAlert> : null}

      <Button
        type="button"
        fullWidth
        loading={submitting}
        loadingLabel="Checking code..."
        disabled={code.length !== 6}
        onClick={() => verify(code)}
      >
        Verify email
      </Button>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-[var(--neutral-600)]">Didn&apos;t get it? Check spam, or</span>
        <button
          type="button"
          onClick={resend}
          disabled={cooldown > 0}
          className="font-medium text-[var(--accent-600)] underline underline-offset-4 disabled:text-[var(--neutral-400)] disabled:no-underline cursor-pointer disabled:cursor-default"
        >
          {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
        </button>
      </div>
      <p className="text-xs text-[var(--neutral-500)]">
        You can also use the link in the same email.
      </p>
    </div>
  );
}
