"use client";

import { useState } from "react";
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--neutral-200)] pb-4">
        <div className="space-y-1">
          <h2 className="text-xl font-medium m-0">Originality &amp; academic integrity tools</h2>
          <p className="text-xs text-[var(--neutral-600)] m-0">
            No tool can guarantee a university detector&apos;s score. Export your real
            writing-process log and adapt this disclosure statement to your institution&apos;s
            rules.
          </p>
        </div>
        <a
          href={`/api/projects/${projectId}/integrity`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center min-h-[44px] px-4 py-2 text-sm font-medium bg-white text-[var(--neutral-900)] border border-[var(--neutral-300)] rounded-[var(--radius-sm)] hover:bg-[var(--neutral-100)] shrink-0"
        >
          Export process log (JSON)
        </a>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <label
            htmlFor="ai-disclosure-box"
            className="text-sm font-medium text-[var(--neutral-800)]"
          >
            Editable AI-use disclosure statement
          </label>
          <Button type="button" variant="secondary" onClick={handleCopy}>
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
