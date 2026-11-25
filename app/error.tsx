"use client";

import { useEffect } from "react";
import { CollateLogo } from "@/components/brand/collate-logo";
import { Button } from "@/components/ui/button";

interface ErrorBoundaryProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function AppError({ error, reset }: ErrorBoundaryProps) {
  useEffect(() => {
    console.error("[Collate] Unhandled route error:", error.message, error.digest ?? "");
  }, [error]);

  return (
    <main className="min-h-screen grid place-items-center p-6 bg-[var(--neutral-50)]">
      <section
        role="alert"
        className="w-full max-w-[480px] bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-8 space-y-4"
      >
        <p className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--neutral-700)]">
          <CollateLogo className="w-4 h-4 text-[var(--accent-600)] shrink-0" />
          <span style={{ fontFamily: "var(--font-serif)" }}>Collate</span>
        </p>
        <h1 className="text-2xl font-medium">Something went wrong</h1>
        <p className="text-[var(--neutral-600)] leading-relaxed">
          An unexpected error interrupted this page. Your saved work is unaffected; try loading the
          page again.
        </p>
        {error.digest ? (
          <p className="text-xs text-[var(--neutral-500)]">
            Reference ID: <code>{error.digest}</code>
          </p>
        ) : null}
        <Button type="button" onClick={reset}>
          Try again
        </Button>
      </section>
    </main>
  );
}
