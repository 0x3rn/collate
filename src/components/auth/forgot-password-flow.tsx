"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { FormAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/field";
import { postJson, RESEND_COOLDOWN_SECONDS } from "./auth-requests";
import { CodeInput } from "./code-input";

type Step = "email" | "code" | "password" | "done";

/**
 * Forgot password in three steps: email -> 6-digit code -> new password. Used in the sign-in
 * pop-up, on /forgot-password, and from "Forgot password?" in the account's change-password box.
 */
export function ForgotPasswordFlow({
  initialEmail = "",
  lockEmail = false,
  onDone,
  doneLabel = "Sign in",
}: {
  initialEmail?: string;
  /** When signed in, the email is the account's own and cannot be edited. */
  lockEmail?: boolean;
  onDone?: () => void;
  doneLabel?: string;
}) {
  const [step, setStep] = useState<Step>(initialEmail && lockEmail ? "email" : "email");
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function sendCode(e?: FormEvent) {
    e?.preventDefault();
    if (!email.includes("@")) {
      setError("Enter the email address on your account.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await postJson("/api/auth/forgot-password", { email: email.trim() });
    setBusy(false);
    if (!res.ok) {
      setError(res.data.error ?? "We could not send a code. Try again shortly.");
      return;
    }
    setCooldown(RESEND_COOLDOWN_SECONDS);
    setNotice(step === "code" ? "We sent a new code. The previous code no longer works." : null);
    setCode("");
    setStep("code");
  }

  const checkCode = useCallback(
    async (value: string) => {
      if (value.length !== 6 || busy) return;
      setBusy(true);
      setError(null);
      const res = await postJson<{ resetToken?: string }>("/api/auth/reset-password/verify-code", {
        email: email.trim(),
        code: value,
      });
      setBusy(false);
      if (!res.ok || !res.data.resetToken) {
        setError(res.data.error ?? "That code is not right.");
        setCode("");
        return;
      }
      setResetToken(res.data.resetToken);
      setNotice(null);
      setStep("password");
    },
    [busy, email]
  );

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    if (password.length < 12) {
      setError("Use at least 12 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await postJson("/api/auth/reset-password", {
      token: resetToken,
      newPassword: password,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.data.error ?? "We could not save your new password.");
      return;
    }
    setStep("done");
  }

  if (step === "done") {
    return (
      <div className="space-y-4">
        <FormAlert tone="success">
          Your password has been changed. For your security, every device was signed out.
        </FormAlert>
        {onDone ? (
          <Button type="button" fullWidth onClick={onDone}>
            {doneLabel}
          </Button>
        ) : null}
      </div>
    );
  }

  if (step === "password") {
    return (
      <form onSubmit={savePassword} noValidate className="space-y-4">
        <FormField
          id="reset-new-password"
          label="New password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          helpText="Use at least 12 characters. A four-word passphrase works well."
          autoFocus
        />
        <FormField
          id="reset-confirm-password"
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {error ? <FormAlert tone="error">{error}</FormAlert> : null}
        <Button type="submit" fullWidth loading={busy} loadingLabel="Saving...">
          Save new password
        </Button>
      </form>
    );
  }

  if (step === "code") {
    return (
      <div className="space-y-5">
        <p className="text-sm text-[var(--neutral-700)] leading-relaxed">
          If an account exists for{" "}
          <strong className="font-semibold text-[var(--neutral-900)] [overflow-wrap:anywhere]">
            {email}
          </strong>
          , we sent it a 6-digit code. It expires in 10 minutes.
        </p>
        <CodeInput
          id="reset-code"
          value={code}
          onChange={(v) => {
            setCode(v);
            if (error) setError(null);
          }}
          onComplete={checkCode}
          invalid={Boolean(error)}
          disabled={busy}
        />
        {error ? <FormAlert tone="error">{error}</FormAlert> : null}
        {notice ? <FormAlert tone="success">{notice}</FormAlert> : null}
        <Button
          type="button"
          fullWidth
          loading={busy}
          loadingLabel="Checking code..."
          disabled={code.length !== 6}
          onClick={() => checkCode(code)}
        >
          Continue
        </Button>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          {lockEmail ? (
            <span />
          ) : (
            <button
              type="button"
              onClick={() => {
                setStep("email");
                setError(null);
              }}
              className="text-[var(--neutral-600)] underline underline-offset-4 cursor-pointer"
            >
              Use a different email
            </button>
          )}
          <button
            type="button"
            onClick={() => sendCode()}
            disabled={cooldown > 0 || busy}
            className="font-medium text-[var(--accent-600)] underline underline-offset-4 disabled:text-[var(--neutral-400)] disabled:no-underline cursor-pointer disabled:cursor-default"
          >
            {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={sendCode} noValidate className="space-y-4">
      {lockEmail ? (
        <p className="text-sm text-[var(--neutral-700)] leading-relaxed">
          We will send a 6-digit code to{" "}
          <strong className="font-semibold text-[var(--neutral-900)] [overflow-wrap:anywhere]">
            {email}
          </strong>{" "}
          so you can choose a new password.
        </p>
      ) : (
        <FormField
          id="reset-email"
          label="Email address"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          helpText="We will email you a 6-digit code."
          autoFocus
        />
      )}
      {error ? <FormAlert tone="error">{error}</FormAlert> : null}
      <Button type="submit" fullWidth loading={busy} loadingLabel="Sending code...">
        Send code
      </Button>
    </form>
  );
}
