"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { TurnstileWidget } from "@/components/ui/turnstile-widget";
import { SignUpTermsText, TermsCheckbox } from "@/components/legal/terms-checkbox";
import { GoogleAuthButton } from "./google-auth-button";
import { VerifyCodePanel } from "./verify-code-panel";

export function SignUpForm({
  turnstileSiteKey,
  googleEnabled = false,
}: {
  turnstileSiteKey: string;
  googleEnabled?: boolean;
}) {
  const toast = useToast();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [touched, setTouched] = useState<{ name?: boolean; email?: boolean; password?: boolean }>(
    {}
  );
  const [submitting, setSubmitting] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [termsError, setTermsError] = useState<string | null>(null);
  const termsRef = useRef<HTMLInputElement>(null);

  function requireTerms(): boolean {
    if (termsAccepted) return true;
    setTermsError("Tick this box to agree before creating your account.");
    termsRef.current?.focus();
    termsRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    return false;
  }

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

    if (name.trim().length < 2 || !email.includes("@") || password.length < 12) {
      return;
    }
    if (!requireTerms()) return;

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
          acceptTerms: true,
        }),
      });
      const data = (await res.json()) as { ok: boolean; message?: string; error?: string };
      if (!res.ok || !data.ok) {
        toast.error(
          data.error ?? "We could not create your account. Check your details and try again.",
          "Could not create account"
        );
        return;
      }
      setPendingEmail(email.trim().toLowerCase());
      setPassword("");
    } catch {
      toast.error(
        "Network error while reaching the server. Check your connection and try again.",
        "Connection error"
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (pendingEmail) {
    return (
      <VerifyCodePanel
        email={pendingEmail}
        onVerified={() =>
          router.push(`/sign-in?verified=1&email=${encodeURIComponent(pendingEmail)}`)
        }
      />
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      {googleEnabled ? (
        <div className="space-y-4 pb-1">
          <GoogleAuthButton
            label="Sign up with Google"
            termsAccepted={termsAccepted}
            onTermsMissing={() => void requireTerms()}
          />
          <div className="flex items-center gap-3 text-xs text-[var(--neutral-500)]">
            <span className="h-px flex-1 bg-[var(--neutral-200)]" />
            or use your email
            <span className="h-px flex-1 bg-[var(--neutral-200)]" />
          </div>
        </div>
      ) : null}
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

      <TermsCheckbox
        ref={termsRef}
        id="signup-terms"
        checked={termsAccepted}
        onChange={(checked) => {
          setTermsAccepted(checked);
          if (checked) setTermsError(null);
        }}
        error={termsError}
      >
        <SignUpTermsText />
      </TermsCheckbox>

      <div className="pt-2">
        <Button type="submit" fullWidth loading={submitting} loadingLabel="Creating account...">
          Create account
        </Button>
      </div>
    </form>
  );
}
