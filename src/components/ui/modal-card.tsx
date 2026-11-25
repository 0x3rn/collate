"use client";

import { useEffect, useId, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button, LinkButton } from "@/components/ui/button";
import { formatCredits } from "@/lib/ui/formatters";

/**
 * Editorial body-portaled centered pop-up card with a top-right X close icon,
 * backdrop click dismissal, and Escape-key support.
 * Reserved strictly for action-required moments (providing details, credit top-ups,
 * or verification actions) where a fading bottom-right toast is not enough.
 */
export function ModalCard({
  open,
  onClose,
  eyebrow,
  title,
  maxWidthClassName = "max-w-[500px]",
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  eyebrow?: string;
  title: string;
  maxWidthClassName?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-[1px]"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`modal-enter w-full ${maxWidthClassName} max-h-[calc(100vh-2rem)] flex flex-col bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] shadow-[0_20px_50px_rgba(24,24,27,0.16)] overflow-hidden`}
      >
        <div className="px-6 py-4 bg-[var(--neutral-50)] border-b border-[var(--neutral-200)] flex items-start justify-between gap-4 shrink-0">
          <div className="flex flex-col gap-1 min-w-0">
            {eyebrow ? (
              <p className="text-xs font-medium text-[var(--accent-600)]">{eyebrow}</p>
            ) : null}
            <h3 id={titleId} className="text-lg font-medium text-[var(--neutral-900)]">
              {title}
            </h3>
          </div>
          <button
            type="button"
            aria-label="Close dialog"
            onClick={onClose}
            className="w-8 h-8 -mt-1 -mr-1 rounded-[var(--radius-sm)] grid place-items-center text-[var(--neutral-500)] hover:text-[var(--neutral-900)] hover:bg-[var(--neutral-100)] transition-colors cursor-pointer shrink-0"
          >
            <svg
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
              className="w-4 h-4"
            >
              <path d="M5.5 5.5 14.5 14.5M14.5 5.5 5.5 14.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="p-6 flex flex-col gap-5 overflow-y-auto">{children}</div>

        {footer ? (
          <div className="px-6 py-4 bg-[var(--neutral-50)] border-t border-[var(--neutral-200)] flex items-center justify-end gap-2.5 shrink-0">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  );
}

export interface InsufficientCreditsDetails {
  actionLabel: string;
  creditsRequired: number;
  creditsAvailable?: number;
  message?: string;
}

/**
 * Action-required pop-up card shown when a user tries to start a chapter, revision,
 * assignment, or paid topic sweep without enough credits.
 */
export function InsufficientCreditsModal({
  details,
  onClose,
}: {
  details: InsufficientCreditsDetails | null;
  onClose: () => void;
}) {
  const required = details?.creditsRequired ?? 0;
  const available = details?.creditsAvailable ?? 0;
  const shortfall = Math.max(0, required - available);

  return (
    <ModalCard
      open={Boolean(details)}
      onClose={onClose}
      eyebrow="Credits required"
      title="Add credits to continue"
      maxWidthClassName="max-w-[460px]"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            Close
          </Button>
          <LinkButton href="/billing" variant="primary">
            Top up credits
          </LinkButton>
        </>
      }
    >
      {details ? (
        <>
          <p className="text-sm text-[var(--neutral-700)] leading-relaxed">
            {details.actionLabel} requires{" "}
            <strong className="font-semibold text-[var(--neutral-900)] tabular-nums">
              {formatCredits(required)}
            </strong>
            {details.creditsAvailable !== undefined ? (
              <>
                , and your current balance is{" "}
                <strong className="font-semibold text-[var(--neutral-900)] tabular-nums">
                  {formatCredits(available)}
                </strong>
                .
              </>
            ) : (
              "."
            )}
          </p>

          <div className="grid grid-cols-3 divide-x divide-[var(--neutral-200)] rounded-[var(--radius-sm)] border border-[var(--neutral-200)] bg-[var(--neutral-50)]">
            <div className="p-3.5 flex flex-col gap-1">
              <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--neutral-500)]">
                Required
              </p>
              <p className="text-base font-semibold text-[var(--neutral-900)] tabular-nums">
                {formatCredits(required)}
              </p>
            </div>
            <div className="p-3.5 flex flex-col gap-1">
              <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--neutral-500)]">
                Available
              </p>
              <p className="text-base font-semibold text-[var(--neutral-900)] tabular-nums">
                {details.creditsAvailable !== undefined ? formatCredits(available) : "—"}
              </p>
            </div>
            <div className="p-3.5 flex flex-col gap-1">
              <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--neutral-500)]">
                Needed
              </p>
              <p className="text-base font-semibold text-[var(--accent-600)] tabular-nums">
                {details.creditsAvailable !== undefined
                  ? formatCredits(shortfall)
                  : formatCredits(required)}
              </p>
            </div>
          </div>

          <p className="text-xs text-[var(--neutral-500)] leading-relaxed">
            Credits are only finalized when drafting finishes cleanly; interrupted runs are refunded
            in full.
          </p>
        </>
      ) : null}
    </ModalCard>
  );
}
