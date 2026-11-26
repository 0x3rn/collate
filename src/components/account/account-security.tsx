"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { postJson, RESEND_COOLDOWN_SECONDS } from "@/components/auth/auth-requests";
import { CodeInput } from "@/components/auth/code-input";
import { ForgotPasswordFlow } from "@/components/auth/forgot-password-flow";
import { FormAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/field";
import { ModalCard } from "@/components/ui/modal-card";
import { useToast } from "@/components/ui/toast";

const linkButton =
  "text-sm font-medium text-[var(--accent-600)] hover:text-[var(--accent-700)] underline underline-offset-4 cursor-pointer w-fit";

// ── Name ────────────────────────────────────────────────────────────────────

export function NameRow({ initialName }: { initialName: string }) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) {
      setError("Enter your full name (at least 2 characters).");
      return;
    }
    setSaving(true);
    const res = await postJson("/api/account/name", { name: name.trim() });
    setSaving(false);
    if (!res.ok) {
      setError(res.data.error ?? "We could not save your name.");
      return;
    }
    setEditing(false);
    toast.success("Your name was updated.", "Saved");
    router.refresh();
  }

  if (!editing) {
    return (
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-[var(--neutral-500)]">Full name</p>
          <p className="text-sm font-medium text-[var(--neutral-900)] mt-1 break-words">
            {initialName}
          </p>
        </div>
        <button type="button" className={linkButton} onClick={() => setEditing(true)}>
          Edit name
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={save} noValidate className="space-y-3">
      <FormField
        id="account-name"
        label="Full name"
        type="text"
        autoComplete="name"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setError(null);
        }}
        error={error ?? undefined}
        autoFocus
      />
      <div className="flex gap-2">
        <Button type="submit" loading={saving} loadingLabel="Saving...">
          Save
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setEditing(false);
            setName(initialName);
            setError(null);
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ── Email ───────────────────────────────────────────────────────────────────

type EmailStep = "intro" | "current_code" | "new_email" | "new_code" | "done";

function useCooldown() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (seconds <= 0) return;
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds]);
  return [seconds, () => setSeconds(RESEND_COOLDOWN_SECONDS)] as const;
}

export function ChangeEmailButton({ currentEmail }: { currentEmail: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<EmailStep>("intro");
  const [code, setCode] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, startCooldown] = useCooldown();

  function reset() {
    setStep("intro");
    setCode("");
    setNewEmail("");
    setError(null);
    setNotice(null);
  }

  async function sendCurrentCode(isResend = false) {
    setBusy(true);
    setError(null);
    const res = await postJson("/api/account/email/start", {});
    setBusy(false);
    if (!res.ok) {
      setError(res.data.error ?? "We could not send the code.");
      return;
    }
    startCooldown();
    setCode("");
    setNotice(isResend ? "We sent a new code. The previous code no longer works." : null);
    setStep("current_code");
  }

  const confirmCurrent = useCallback(
    async (value: string) => {
      if (value.length !== 6 || busy) return;
      setBusy(true);
      setError(null);
      const res = await postJson("/api/account/email/verify-current", { code: value });
      setBusy(false);
      if (!res.ok) {
        setError(res.data.error ?? "That code is not right.");
        setCode("");
        return;
      }
      setNotice(null);
      setStep("new_email");
    },
    [busy]
  );

  async function sendNewCode(e?: FormEvent, isResend = false) {
    e?.preventDefault();
    if (!newEmail.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await postJson("/api/account/email/send-new", { newEmail: newEmail.trim() });
    setBusy(false);
    if (!res.ok) {
      setError(res.data.error ?? "We could not send the code.");
      return;
    }
    startCooldown();
    setCode("");
    setNotice(isResend ? "We sent a new code. The previous code no longer works." : null);
    setStep("new_code");
  }

  const confirmNew = useCallback(
    async (value: string) => {
      if (value.length !== 6 || busy) return;
      setBusy(true);
      setError(null);
      const res = await postJson("/api/account/email/confirm", { code: value });
      setBusy(false);
      if (!res.ok) {
        setError(res.data.error ?? "That code is not right.");
        setCode("");
        return;
      }
      setStep("done");
      router.refresh();
    },
    [busy, router]
  );

  const resendLink = (onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      disabled={cooldown > 0 || busy}
      className="text-sm font-medium text-[var(--accent-600)] underline underline-offset-4 disabled:text-[var(--neutral-400)] disabled:no-underline cursor-pointer disabled:cursor-default"
    >
      {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
    </button>
  );

  return (
    <>
      <button
        type="button"
        className={linkButton}
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        Change email
      </button>
      <ModalCard
        open={open}
        onClose={() => setOpen(false)}
        title={step === "done" ? "Email changed" : "Change your email"}
        maxWidthClassName="max-w-[460px]"
      >
        {step === "intro" ? (
          <div className="space-y-4">
            <p className="text-sm text-[var(--neutral-700)] leading-relaxed">
              We will send a 6-digit code to your current email,{" "}
              <strong className="font-semibold text-[var(--neutral-900)] [overflow-wrap:anywhere]">
                {currentEmail}
              </strong>
              , to confirm it is you.
            </p>
            {error ? <FormAlert tone="error">{error}</FormAlert> : null}
            <Button
              type="button"
              fullWidth
              loading={busy}
              loadingLabel="Sending code..."
              onClick={() => sendCurrentCode()}
            >
              Send code
            </Button>
          </div>
        ) : null}

        {step === "current_code" ? (
          <div className="space-y-5">
            <p className="text-sm text-[var(--neutral-700)] leading-relaxed">
              A code has been sent to your current email,{" "}
              <strong className="font-semibold text-[var(--neutral-900)] [overflow-wrap:anywhere]">
                {currentEmail}
              </strong>
              . Please verify it before changing your email.
            </p>
            <CodeInput
              id="email-current-code"
              value={code}
              onChange={(v) => {
                setCode(v);
                setError(null);
              }}
              onComplete={confirmCurrent}
              invalid={Boolean(error)}
              disabled={busy}
            />
            {error ? <FormAlert tone="error">{error}</FormAlert> : null}
            {notice ? <FormAlert tone="success">{notice}</FormAlert> : null}
            <Button
              type="button"
              fullWidth
              loading={busy}
              loadingLabel="Checking..."
              disabled={code.length !== 6}
              onClick={() => confirmCurrent(code)}
            >
              Verify
            </Button>
            <div className="text-right">{resendLink(() => sendCurrentCode(true))}</div>
          </div>
        ) : null}

        {step === "new_email" ? (
          <form onSubmit={sendNewCode} noValidate className="space-y-4">
            <p className="text-sm text-[var(--neutral-700)]">
              Confirmed. Now add your new email address. We will send a code to it.
            </p>
            <FormField
              id="email-new"
              label="New email address"
              type="email"
              autoComplete="email"
              value={newEmail}
              onChange={(e) => {
                setNewEmail(e.target.value);
                setError(null);
              }}
              autoFocus
            />
            {error ? <FormAlert tone="error">{error}</FormAlert> : null}
            <Button type="submit" fullWidth loading={busy} loadingLabel="Sending code...">
              Send code to new email
            </Button>
          </form>
        ) : null}

        {step === "new_code" ? (
          <div className="space-y-5">
            <p className="text-sm text-[var(--neutral-700)] leading-relaxed">
              Enter the 6-digit code we sent to{" "}
              <strong className="font-semibold text-[var(--neutral-900)] [overflow-wrap:anywhere]">
                {newEmail.trim().toLowerCase()}
              </strong>
              .
            </p>
            <CodeInput
              id="email-new-code"
              value={code}
              onChange={(v) => {
                setCode(v);
                setError(null);
              }}
              onComplete={confirmNew}
              invalid={Boolean(error)}
              disabled={busy}
            />
            {error ? <FormAlert tone="error">{error}</FormAlert> : null}
            {notice ? <FormAlert tone="success">{notice}</FormAlert> : null}
            <Button
              type="button"
              fullWidth
              loading={busy}
              loadingLabel="Checking..."
              disabled={code.length !== 6}
              onClick={() => confirmNew(code)}
            >
              Change email
            </Button>
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  setStep("new_email");
                  setError(null);
                }}
                className="text-sm text-[var(--neutral-600)] underline underline-offset-4 cursor-pointer"
              >
                Use a different email
              </button>
              {resendLink(() => sendNewCode(undefined, true))}
            </div>
          </div>
        ) : null}

        {step === "done" ? (
          <div className="space-y-4">
            <FormAlert tone="success">
              Your email is now {newEmail.trim().toLowerCase()}. We let your old address know.
            </FormAlert>
            <Button type="button" fullWidth onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
        ) : null}
      </ModalCard>
    </>
  );
}

// ── Password ────────────────────────────────────────────────────────────────

export function ChangePasswordButton({
  email,
  hasPassword,
}: {
  email: string;
  hasPassword: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [forgot, setForgot] = useState(!hasPassword);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!current) return setError("Enter your current password.");
    if (next.length < 12) return setError("Use at least 12 characters for the new password.");
    if (next !== confirm) return setError("The two new passwords do not match.");
    setBusy(true);
    setError(null);
    const res = await postJson("/api/account/password", {
      currentPassword: current,
      newPassword: next,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.data.error ?? "We could not change your password.");
      return;
    }
    setOpen(false);
    toast.success(
      "Your password was changed and other devices were signed out.",
      "Password changed"
    );
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        className={linkButton}
        onClick={() => {
          setForgot(!hasPassword);
          setCurrent("");
          setNext("");
          setConfirm("");
          setError(null);
          setOpen(true);
        }}
      >
        {hasPassword ? "Change password" : "Set password"}
      </button>
      <ModalCard
        open={open}
        onClose={() => setOpen(false)}
        eyebrow="Password"
        title={
          forgot
            ? hasPassword
              ? "Reset your password"
              : "Set your password"
            : "Change your password"
        }
        maxWidthClassName="max-w-[460px]"
      >
        {forgot ? (
          <ForgotPasswordFlow
            initialEmail={email}
            lockEmail
            doneLabel="Sign in again"
            onDone={() => router.push("/sign-in")}
          />
        ) : (
          <form onSubmit={save} noValidate className="space-y-4">
            <div className="space-y-1.5">
              <FormField
                id="pw-current"
                label="Current password"
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => {
                  setCurrent(e.target.value);
                  setError(null);
                }}
                autoFocus
              />
              <div className="text-right">
                <button
                  type="button"
                  onClick={() => {
                    setForgot(true);
                    setError(null);
                  }}
                  className="text-sm text-[var(--accent-600)] hover:underline underline-offset-4 cursor-pointer"
                >
                  Forgot password?
                </button>
              </div>
            </div>
            <FormField
              id="pw-new"
              label="New password"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => {
                setNext(e.target.value);
                setError(null);
              }}
              helpText="Use at least 12 characters. A four-word passphrase works well."
            />
            <FormField
              id="pw-confirm"
              label="Confirm new password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => {
                setConfirm(e.target.value);
                setError(null);
              }}
            />
            {error ? <FormAlert tone="error">{error}</FormAlert> : null}
            <Button type="submit" fullWidth loading={busy} loadingLabel="Changing password...">
              Change password
            </Button>
          </form>
        )}
      </ModalCard>
    </>
  );
}

// ── Active sessions ─────────────────────────────────────────────────────────

interface SessionRow {
  id: string;
  current: boolean;
  device: string;
  kind: "desktop" | "mobile" | "tablet";
  location: string | null;
  lastActiveAt: string;
}

function DeviceIcon({ kind }: { kind: SessionRow["kind"] }) {
  return kind === "desktop" ? (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      aria-hidden="true"
      className="w-5 h-5"
    >
      <rect x="2.5" y="3.5" width="15" height="10" rx="1.5" />
      <path d="M7 16.5h6M10 13.5v3" strokeLinecap="round" />
    </svg>
  ) : (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      aria-hidden="true"
      className="w-5 h-5"
    >
      <rect x="5.5" y="2.5" width="9" height="15" rx="1.8" />
      <path d="M9 15h2" strokeLinecap="round" />
    </svg>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 5) return "Active now";
  if (minutes < 60) return `Active ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Active ${hours} h ago`;
  const days = Math.round(hours / 24);
  return `Active ${days} day${days === 1 ? "" : "s"} ago`;
}

export function ActiveSessions() {
  const router = useRouter();
  const toast = useToast();
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/account/sessions", { cache: "no-store" });
      const data = (await res.json()) as { ok: boolean; sessions?: SessionRow[]; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Could not load your devices.");
      setRows(data.sessions ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your devices.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function signOutSession(id: string) {
    setBusyId(id);
    const res = await postJson("/api/account/sessions/revoke", { sessionId: id });
    setBusyId(null);
    if (!res.ok) toast.error(res.data.error ?? "Could not sign out that device.", "Not signed out");
    await load();
  }

  async function signOutCurrent() {
    setBusyId("current");
    await fetch("/api/auth/signout", { method: "POST" }).catch(() => null);
    router.push("/sign-in");
    router.refresh();
  }

  async function signOutOthers() {
    setBusyId("others");
    const res = await postJson<{ signedOut?: number }>("/api/account/sessions/revoke", {
      allOthers: true,
    });
    setBusyId(null);
    if (res.ok) {
      const n = res.data.signedOut ?? 0;
      toast.success(
        n === 0
          ? "No other devices were signed in."
          : `Signed out of ${n} other device${n === 1 ? "" : "s"}.`,
        "Done"
      );
    } else {
      toast.error(res.data.error ?? "Could not sign out other devices.", "Not signed out");
    }
    await load();
  }

  const others = rows?.filter((r) => !r.current).length ?? 0;

  return (
    <div className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)]">
      {error ? (
        <div className="p-5">
          <FormAlert tone="error">{error}</FormAlert>
        </div>
      ) : rows === null ? (
        <p className="p-5 text-sm text-[var(--neutral-500)]">Loading your devices…</p>
      ) : (
        <>
          <ul
            className="list-none p-0 m-0 divide-y divide-[var(--neutral-200)] max-h-[352px] overflow-y-auto"
            aria-label="Signed-in devices"
          >
            {rows.map((row) => (
              <li key={row.id} className="px-5 py-3.5 flex items-center gap-3.5 min-h-[70px]">
                <span className="shrink-0 w-9 h-9 rounded-full bg-[var(--neutral-100)] text-[var(--neutral-600)] grid place-items-center">
                  <DeviceIcon kind={row.kind} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[var(--neutral-900)] flex items-center gap-2 flex-wrap">
                    {row.device}
                    {row.current ? (
                      <span className="inline-flex px-1.5 py-0.5 text-[11px] font-medium rounded-[4px] bg-[var(--success-bg)] text-[var(--success-text)]">
                        This device
                      </span>
                    ) : null}
                  </p>
                  <p className="text-xs text-[var(--neutral-500)] mt-0.5">
                    {[
                      row.location ?? "Location unknown",
                      row.current ? "Active now" : timeAgo(row.lastActiveAt),
                    ].join(" · ")}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busyId !== null}
                  onClick={() => (row.current ? signOutCurrent() : signOutSession(row.id))}
                  className="shrink-0 text-sm font-medium text-[var(--accent-600)] hover:text-[var(--accent-700)] underline underline-offset-4 disabled:text-[var(--neutral-400)] cursor-pointer"
                >
                  {busyId === row.id || (row.current && busyId === "current")
                    ? "Signing out…"
                    : "Sign out"}
                </button>
              </li>
            ))}
          </ul>
          {rows.length > 5 ? (
            <p className="px-5 py-2 text-xs text-[var(--neutral-500)] border-t border-[var(--neutral-200)]">
              Scroll to see more devices.
            </p>
          ) : null}
          <div className="px-5 py-4 border-t border-[var(--neutral-200)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <p className="text-sm text-[var(--neutral-600)]">
              {others === 0
                ? "You are only signed in on this device."
                : `Signed in on ${others} other device${others === 1 ? "" : "s"}.`}
            </p>
            <Button
              className="shrink-0 whitespace-nowrap"
              type="button"
              variant="secondary"
              disabled={others === 0}
              loading={busyId === "others"}
              loadingLabel="Signing out..."
              onClick={signOutOthers}
            >
              Sign out of all other devices
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
