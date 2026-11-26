"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { ModalCard } from "@/components/ui/modal-card";
import { useToast } from "@/components/ui/toast";

/**
 * One-time dashboard prompt asking new users whether they would like occasional emails
 * about new features, updates, and special offers.
 */
export function MarketingOptInModal({ initialOpen }: { initialOpen: boolean }) {
  const toast = useToast();
  const [open, setOpen] = useState(initialOpen);
  const [saving, setSaving] = useState<"yes" | "no" | null>(null);

  const respond = useCallback(
    async (optIn: boolean) => {
      if (saving !== null) return;
      setSaving(optIn ? "yes" : "no");
      try {
        const res = await fetch("/api/account/marketing-prompt", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ optIn }),
        });
        if (res.ok && optIn) {
          toast.success(
            "You are subscribed to occasional product updates and feature announcements.",
            "Email updates enabled"
          );
        }
      } catch {
        // Close cleanly even on transient failure; user can change anytime in Account settings.
      } finally {
        setSaving(null);
        setOpen(false);
      }
    },
    [saving, toast]
  );

  return (
    <ModalCard
      open={open}
      onClose={() => void respond(false)}
      eyebrow="Email updates"
      title="Receive news and feature updates?"
      maxWidthClassName="max-w-[460px]"
      footer={
        <>
          <Button
            type="button"
            variant="secondary"
            disabled={saving !== null}
            loading={saving === "no"}
            loadingLabel="Saving..."
            onClick={() => void respond(false)}
          >
            No thanks
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={saving !== null}
            loading={saving === "yes"}
            loadingLabel="Saving..."
            onClick={() => void respond(true)}
          >
            Yes, keep me posted
          </Button>
        </>
      }
    >
      <p className="text-sm text-[var(--neutral-700)] leading-relaxed">
        Get occasional emails when we add new features, formatting tools, or credit offers. You can
        unsubscribe or update this anytime in{" "}
        <Link
          href="/account"
          onClick={() => void respond(false)}
          className="font-medium text-[var(--accent-700)] underline underline-offset-2 hover:text-[var(--accent-600)]"
        >
          Account settings
        </Link>
        .
      </p>
    </ModalCard>
  );
}
