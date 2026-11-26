"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { FormAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/field";
import { ModalCard } from "@/components/ui/modal-card";
import { useToast } from "@/components/ui/toast";
import { TurnstileWidget } from "@/components/ui/turnstile-widget";
import { postJson } from "./auth-requests";
import { ForgotPasswordFlow } from "./forgot-password-flow";
import { GoogleAuthButton } from "./google-auth-button";
import { VerifyCodePanel } from "./verify-code-panel";

export function SignInForm({
  turnstileSiteKey,
  nextPath,
  initialEmail = "",
  justVerified = false,
  googleEnabled = false,
  googleError = null,
}: {
  turnstileSiteKey: string;
  nextPath: string;
  initialEmail?: string;
  justVerified?: boolean;
  googleEnabled?: boolean;
  googleError?: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const [codeSent, setCodeSent] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);

  async function signIn(): Promise<void> {
    setSubmitting(true);
    const res = await postJson<{ code?: string }>("/api/auth/signin", {
      email: email.trim(),
      password,
      turnstileToken: turnstileToken || undefined,
    });
    setSubmitting(false);
    if (!res.ok) {
      if (res.data.code === "EMAIL_NOT_VERIFIED") {
        setUnverifiedEmail(email.trim());
        setCodeSent(false);
        return;
      }
      toast.error(res.data.error ?? "Invalid email or password.", "Could not sign in");
      return;
    }
    router.push(nextPath);
    router.refresh();
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!email.trim() || !password) {
      toast.error("Enter both your email address and password.", "Missing details");
      return;
    }
    await signIn();
  }

  async function sendVerificationCode() {
    if (!unverifiedEmail) return;
    setSendingCode(true);
    const res = await postJson("/api/auth/resend-verification", { email: unverifiedEmail });
    setSendingCode(false);
    if (!res.ok) {
      toast.error(res.data.error ?? "We could not send a code. Try again shortly.", "Not sent");
      return;
    }
    setCodeSent(true);
  }

  return (
    <>
      {justVerified ? (
        <FormAlert tone="success" className="mb-4">
          Your email is verified. Sign in to continue.
        </FormAlert>
      ) : null}
      {googleError ? (
        <FormAlert tone="error" className="mb-4">
          {googleError}
        </FormAlert>
      ) : null}

      {googleEnabled ? (
        <div className="space-y-4 mb-5">
          <GoogleAuthButton label="Sign in with Google" nextPath={nextPath} />
          <div className="flex items-center gap-3 text-xs text-[var(--neutral-500)]">
            <span className="h-px flex-1 bg-[var(--neutral-200)]" />
            or use your email
            <span className="h-px flex-1 bg-[var(--neutral-200)]" />
          </div>
        </div>
      ) : null}

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
            <button
              type="button"
              onClick={() => setForgotOpen(true)}
              className="text-sm text-[var(--accent-600)] hover:underline underline-offset-4 cursor-pointer"
            >
              Forgot password?
            </button>
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
        open={forgotOpen}
        onClose={() => setForgotOpen(false)}
        eyebrow="Forgot password"
        title="Reset your password"
        maxWidthClassName="max-w-[440px]"
      >
        <ForgotPasswordFlow
          initialEmail={email.trim()}
          onDone={() => {
            setForgotOpen(false);
            setPassword("");
          }}
          doneLabel="Back to sign in"
        />
      </ModalCard>

      <ModalCard
        open={Boolean(unverifiedEmail)}
        onClose={() => setUnverifiedEmail(null)}
        eyebrow="Email verification"
        title="Verify your email to sign in"
        maxWidthClassName="max-w-[440px]"
      >
        {codeSent && unverifiedEmail ? (
          <VerifyCodePanel
            email={unverifiedEmail}
            onVerified={async () => {
              setUnverifiedEmail(null);
              await signIn();
            }}
          />
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-[var(--neutral-700)] leading-relaxed">
              Your account for{" "}
              <strong className="font-semibold text-[var(--neutral-900)] [overflow-wrap:anywhere]">
                {unverifiedEmail}
              </strong>{" "}
              is not verified yet. We will email you a 6-digit code to finish setting it up.
            </p>
            <Button
              type="button"
              fullWidth
              loading={sendingCode}
              loadingLabel="Sending code..."
              onClick={sendVerificationCode}
            >
              Send code
            </Button>
          </div>
        )}
      </ModalCard>
    </>
  );
}
