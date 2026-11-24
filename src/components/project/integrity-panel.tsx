"use client";

import { useState } from "react";
import { DownloadIcon } from "@/components/layout/workspace-icons";
import { Button } from "@/components/ui/button";

export function IntegrityPanel({
  projectId,
  disclosureStatement,
}: {
  projectId: string;
  disclosureStatement: string;
}) {
  const [text, setText] = useState(disclosureStatement);
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked in non-HTTPS contexts
    }
  }

  return (
    <section className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-6 space-y-5">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[var(--neutral-200)] pb-5">
        <div className="space-y-1.5">
          <h2 className="text-lg font-medium text-[var(--neutral-900)]">
            Academic integrity &amp; disclosure
          </h2>
          <p className="text-sm text-[var(--neutral-600)] leading-relaxed max-w-[60ch]">
            No tool can guarantee a university detector&apos;s score. Download a readable summary of
            your research and drafting history, or adapt the disclosure note below to fit your
            school&apos;s guidelines.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <a
            href={`/api/projects/${projectId}/integrity?format=pdf`}
            className="inline-flex items-center justify-center gap-1.5 min-h-[40px] px-3.5 py-2 text-sm font-medium bg-white text-[var(--neutral-900)] border border-[var(--neutral-300)] rounded-[var(--radius-sm)] hover:bg-[var(--neutral-100)] whitespace-nowrap transition-colors"
          >
            <DownloadIcon className="w-4 h-4 text-[var(--accent-600)]" />
            <span>Writing log (.pdf)</span>
          </a>
          <a
            href={`/api/projects/${projectId}/integrity?format=txt`}
            className="inline-flex items-center justify-center min-h-[40px] px-3 py-2 text-xs font-medium bg-[var(--neutral-50)] text-[var(--neutral-700)] border border-[var(--neutral-200)] rounded-[var(--radius-sm)] hover:bg-[var(--neutral-100)] hover:text-[var(--neutral-900)] whitespace-nowrap transition-colors"
          >
            Text (.txt)
          </a>
          <a
            href={`/api/projects/${projectId}/integrity?format=md`}
            className="inline-flex items-center justify-center min-h-[40px] px-3 py-2 text-xs font-medium bg-[var(--neutral-50)] text-[var(--neutral-700)] border border-[var(--neutral-200)] rounded-[var(--radius-sm)] hover:bg-[var(--neutral-100)] hover:text-[var(--neutral-900)] whitespace-nowrap transition-colors"
          >
            Markdown (.md)
          </a>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-0.5 min-w-0">
            <label
              htmlFor="ai-disclosure-box"
              className="block text-sm font-medium text-[var(--neutral-800)] leading-snug"
            >
              Editable AI-use disclosure statement
            </label>
            <p className="text-xs text-[var(--neutral-500)] leading-snug m-0">
              Optional. Only use if your institution requires an AI-use disclosure.
            </p>
          </div>
          <Button type="button" variant="secondary" onClick={handleCopy} className="shrink-0">
            {copied ? "Copied" : "Copy statement"}
          </Button>
        </div>
        <textarea
          id="ai-disclosure-box"
          rows={7}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="block w-full px-3.5 py-2.5 text-sm bg-[var(--neutral-50)] text-[var(--neutral-900)] border border-[var(--neutral-300)] rounded-[var(--radius-sm)] leading-relaxed"
        />
      </div>
    </section>
  );
}
