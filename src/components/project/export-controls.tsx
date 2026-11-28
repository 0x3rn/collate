"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { ProjectType } from "@/db/schema";
import { formatProjectType } from "@/lib/ui/formatters";

export function ExportControls({
  projectId,
  projectType = "project",
  useChapters = true,
  hasCompletedChapters,
  allChaptersReady,
}: {
  projectId: string;
  projectType?: ProjectType;
  useChapters?: boolean;
  hasCompletedChapters: boolean;
  allChaptersReady: boolean;
}) {
  const workNounLower = formatProjectType(projectType).toLowerCase();
  const toast = useToast();
  const [workingKey, setWorkingKey] = useState<string | null>(null);

  async function triggerExport(scope: "combined" | "full", format: "pdf" | "docx") {
    const key = `${scope}-${format}`;
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
        toast.error(data.error ?? "Could not generate export. Try again.", "Download unavailable");
        return;
      }
      window.location.href = data.export.downloadUrl;
    } catch {
      toast.error("Network error while preparing your download.", "Download unavailable");
    } finally {
      setWorkingKey(null);
    }
  }

  return (
    <section className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-6 space-y-4">
      <div className="space-y-1.5">
        <h2 className="text-lg font-medium text-[var(--neutral-900)]">Downloads</h2>
        <p className="text-sm text-[var(--neutral-600)] leading-relaxed">
          {useChapters
            ? "The PDF numbers opening pages i, ii, iii and chapters 1, 2, 3, and builds a table of contents with the real page numbers. Word (.docx) matches the same structure for school template edits."
            : "The PDF runs your numbered sections continuously with standard academic formatting and references. Word (.docx) matches the same layout for easy editing."}
        </p>
      </div>

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
          loadingLabel={`Building full ${workNounLower} PDF...`}
          onClick={() => triggerExport("full", "pdf")}
        >
          Download whole {workNounLower} (PDF)
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
