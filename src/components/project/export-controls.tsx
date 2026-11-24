"use client";

import { useState } from "react";
import { FormAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function ExportControls({
  projectId,
  hasCompletedChapters,
  allChaptersReady,
}: {
  projectId: string;
  hasCompletedChapters: boolean;
  allChaptersReady: boolean;
}) {
  const [workingKey, setWorkingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function triggerExport(scope: "combined" | "full", format: "pdf" | "docx") {
    const key = `${scope}-${format}`;
    setError(null);
    setWorkingKey(key);
    try {
      const res = await fetch(`/api/projects/${projectId}/exports`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope, format }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        export?: { downloadUrl: string };
        error?: string;
      };
      if (!res.ok || !data.ok || !data.export?.downloadUrl) {
        setError(data.error ?? "Could not generate export. Try again.");
        return;
      }
      window.location.href = data.export.downloadUrl;
    } catch {
      setError("Network error while preparing your download.");
    } finally {
      setWorkingKey(null);
    }
  }

  return (
    <section className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-6 space-y-4">
      <div className="space-y-1.5">
        <h2 className="text-lg font-medium text-[var(--neutral-900)]">Downloads</h2>
        <p className="text-sm text-[var(--neutral-600)] leading-relaxed">
          Print-ready PDFs include Roman front matter, Arabic body numbering, and an accurate Table
          of Contents. Word (.docx) matches the same structure for school template edits.
        </p>
      </div>

      {error ? <FormAlert tone="error">{error}</FormAlert> : null}

      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="secondary"
          disabled={!hasCompletedChapters || workingKey !== null}
          loading={workingKey === "combined-pdf"}
          loadingLabel="Building combined PDF..."
          onClick={() => triggerExport("combined", "pdf")}
        >
          Download combined PDF
        </Button>

        <Button
          type="button"
          variant="primary"
          disabled={!allChaptersReady || workingKey !== null}
          loading={workingKey === "full-pdf"}
          loadingLabel="Building full thesis PDF..."
          onClick={() => triggerExport("full", "pdf")}
        >
          Download whole project (PDF)
        </Button>

        <Button
          type="button"
          variant="secondary"
          disabled={!hasCompletedChapters || workingKey !== null}
          loading={workingKey === "full-docx"}
          loadingLabel="Building Word file..."
          onClick={() => triggerExport("full", "docx")}
        >
          Download Word (.docx)
        </Button>
      </div>
    </section>
  );
}
