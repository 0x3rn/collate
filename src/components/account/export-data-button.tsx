"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

/** Downloads the signed-in user's own data as a PDF. */
export function ExportDataButton() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    try {
      const res = await fetch("/api/account/export");
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? "The export could not be made. Try again.");
        return;
      }
      const name =
        res.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ??
        "collate-my-data.pdf";
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      toast.error("Network error. Your data was not downloaded.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      variant="secondary"
      onClick={() => void download()}
      loading={busy}
      loadingLabel="Preparing PDF..."
    >
      Export my data
    </Button>
  );
}
