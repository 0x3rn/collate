"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/field";
import { ModalCard } from "@/components/ui/modal-card";
import { useToast } from "@/components/ui/toast";

/** Downloads the evidence as a PDF made by the same renderer as chapter exports. */
export function DownloadEvidenceButton({ paymentId }: { paymentId: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/payments/${encodeURIComponent(paymentId)}/evidence-pdf`);
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? "The PDF could not be made. Try again.");
        return;
      }
      const name =
        res.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ??
        "collate-transaction-record.pdf";
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      toast.error("Network error. The PDF was not downloaded.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button onClick={() => void download()} loading={busy} loadingLabel="Preparing PDF...">
      Download PDF
    </Button>
  );
}

export function CopyTextButton({ text }: { text: string }) {
  const toast = useToast();
  return (
    <Button
      variant="secondary"
      className="print:hidden"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          toast.success("Copied. Paste it into the dispute form.");
        } catch {
          toast.error("Could not copy. Select the text and copy it instead.");
        }
      }}
    >
      Copy statement
    </Button>
  );
}

export function LiftHoldButton({ userId, email }: { userId: string; email: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function lift() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/billing-hold", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, note }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "The hold was not lifted.");
        return;
      }
      setOpen(false);
      toast.success(`${email} can buy and use credits again.`, "Hold lifted");
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="secondary" className="print:hidden" onClick={() => setOpen(true)}>
        Lift hold
      </Button>
      <ModalCard
        open={open}
        onClose={() => !busy && setOpen(false)}
        eyebrow="Account hold"
        title="Lift the hold?"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void lift()} loading={busy} loadingLabel="Lifting...">
              Lift hold
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-[var(--neutral-700)] [overflow-wrap:anywhere]">
            {email} will be able to buy and use credits again. Credits already taken back are not
            returned; grant them from Admin if needed.
          </p>
          <FormField
            id="hold-note"
            label="Note for the audit log"
            value={note}
            placeholder="e.g. Dispute settled by email"
            onChange={(e) => setNote(e.target.value)}
          />
          {error && <p className="text-sm text-[var(--error-text)]">{error}</p>}
        </div>
      </ModalCard>
    </>
  );
}
