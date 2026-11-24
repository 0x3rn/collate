"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { FormAlert } from "@/components/ui/alert";
import { Button, LinkButton } from "@/components/ui/button";
import { FormField } from "@/components/ui/field";
import type { ChapterAttentionInfo } from "@/lib/writing/attention";

export interface ReaderCitationCard {
  citeKey: string;
  title: string;
  year: number | null;
  venue: string | null;
  doi: string | null;
  url: string | null;
}

export interface ReaderVersionItem {
  id: string;
  version: number;
  wordCount: number;
  pageCount: number;
  createdBy: string;
  revisionNotes: string | null;
  createdAt: string;
}

export interface ChapterReaderInitialData {
  projectId: string;
  chapter: {
    id: string;
    number: number;
    title: string;
    status: string;
  };
  attention?: ChapterAttentionInfo | null;
  markdown: string;
  headings: Array<{ id: string; text: string; level: number }>;
  citations: ReaderCitationCard[];
  versions: ReaderVersionItem[];
  verifiedClaimsCount: number;
  originalityReport: {
    passed: boolean;
    overlapScore: number;
    semanticScore: number;
    quoteSharePct: number;
    crossUserScore: number;
  } | null;
}

function renderParagraphWithCitations(
  text: string,
  citationByKey: Map<string, ReaderCitationCard>,
  onInspect: (card: ReaderCitationCard) => void
): ReactNode[] {
  const parts = text.split(/(\[@[^\]]+\])/g);
  return parts.map((part, idx) => {
    if (part.startsWith("[@") && part.endsWith("]")) {
      const inner = part.slice(1, -1);
      const firstKey = inner.split(";")[0]?.replace(/^@/, "").split(",")[0]?.trim() ?? "";
      const card = citationByKey.get(firstKey);
      if (card) {
        return (
          <button
            key={idx}
            type="button"
            title={`${card.title} (${card.year ?? "n.d."})`}
            onMouseEnter={() => onInspect(card)}
            onFocus={() => onInspect(card)}
            onClick={() => onInspect(card)}
            className="inline px-1.5 py-0.5 mx-0.5 text-xs font-medium rounded-[var(--radius-sm)] bg-[var(--accent-100)] text-[var(--accent-600)] hover:underline cursor-pointer"
          >
            {part}
          </button>
        );
      }
    }
    return <span key={idx}>{part}</span>;
  });
}

export function ChapterReaderClient({ initial }: { initial: ChapterReaderInitialData }) {
  const router = useRouter();
  const [mode, setMode] = useState<"read" | "edit">("read");
  const [markdown, setMarkdown] = useState(initial.markdown);
  const [editSummary, setEditSummary] = useState("");
  const [inspectedCitation, setInspectedCitation] = useState<ReaderCitationCard | null>(
    initial.citations[0] ?? null
  );
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const citationByKey = new Map(initial.citations.map((c) => [c.citeKey, c]));
  const hasDraft = markdown.trim().length > 0;
  const isPausedWithoutDraft = initial.chapter.status === "needs_attention" && !hasDraft;

  async function handleResumeChapter() {
    setError(null);
    setNotice(null);
    setResuming(true);
    try {
      const res = await fetch(
        `/api/projects/${initial.projectId}/chapters/${initial.chapter.id}/start`,
        { method: "POST" }
      );
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Could not resume this chapter. Please try again.");
        return;
      }
      setNotice(
        `Chapter ${initial.chapter.number} queued for drafting. You will receive an email as soon as it is ready to review.`
      );
      router.refresh();
    } catch {
      setError("Network error while resuming chapter.");
    } finally {
      setResuming(false);
    }
  }

  async function handleSaveEdit() {
    setError(null);
    setNotice(null);
    if (markdown.trim().length < 20) {
      setError("Chapter text is too short to save.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${initial.projectId}/chapters/${initial.chapter.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          markdown,
          editSummary: editSummary.trim() || undefined,
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        version?: { version: number };
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Could not save your chapter edits.");
        return;
      }
      setEditSummary("");
      setMode("read");
      setNotice(
        `Saved version ${data.version?.version ?? ""} and updated project memory for subsequent chapters.`
      );
      router.refresh();
    } catch {
      setError("Network error while saving edits.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDownloadPdf() {
    setError(null);
    setExporting(true);
    try {
      const res = await fetch(`/api/projects/${initial.projectId}/exports`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scope: "chapter",
          format: "pdf",
          chapterId: initial.chapter.id,
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        export?: { downloadUrl: string };
        error?: string;
      };
      if (!res.ok || !data.ok || !data.export?.downloadUrl) {
        setError(data.error ?? "Could not generate chapter PDF.");
        return;
      }
      window.location.href = data.export.downloadUrl;
    } catch {
      setError("Network error while building chapter PDF.");
    } finally {
      setExporting(false);
    }
  }

  let headingCounter = 0;
  const blocks = markdown.split(/\r?\n\r?\n/).filter((b) => b.trim().length > 0);

  return (
    <div className="space-y-6">
      {!isPausedWithoutDraft ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant={mode === "read" ? "primary" : "secondary"}
              disabled={!hasDraft}
              onClick={() => setMode("read")}
            >
              Read Chapter
            </Button>
            <Button
              type="button"
              variant={mode === "edit" ? "primary" : "secondary"}
              disabled={!hasDraft}
              onClick={() => setMode("edit")}
            >
              Light edit
            </Button>
          </div>

          <Button
            type="button"
            variant="secondary"
            disabled={!hasDraft}
            loading={exporting}
            loadingLabel="Building PDF..."
            onClick={handleDownloadPdf}
          >
            Download Chapter PDF
          </Button>
        </div>
      ) : null}

      {error ? <FormAlert tone="error">{error}</FormAlert> : null}
      {notice ? <FormAlert tone="success">{notice}</FormAlert> : null}

      {initial.chapter.status === "needs_attention" && hasDraft && initial.attention ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--warning-border)] bg-[var(--warning-bg)] p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1 text-sm text-[var(--warning-text)]">
            <p className="font-semibold m-0">{initial.attention.title}</p>
            <p className="m-0 leading-relaxed">{initial.attention.userMessage}</p>
          </div>
          <div className="shrink-0 flex items-center gap-2">
            {initial.attention.kind === "user_input_required" ? (
              <LinkButton href={`/projects/${initial.projectId}`} variant="primary">
                Provide Details
              </LinkButton>
            ) : (
              <Button
                type="button"
                variant="primary"
                loading={resuming}
                loadingLabel="Resuming..."
                onClick={handleResumeChapter}
              >
                Resume Chapter {initial.chapter.number}
              </Button>
            )}
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Main reader / editor pane */}
        <div className="lg:col-span-8 bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-6 sm:p-8 space-y-5">
          {isPausedWithoutDraft ? (
            <div className="space-y-5 py-2">
              <div className="space-y-2">
                <span className="inline-flex items-center px-2.5 py-0.5 text-xs font-medium border rounded-[4px] bg-[var(--warning-bg)] text-[var(--warning-text)] border-[var(--warning-border)]">
                  Needs Attention
                </span>
                <h2 className="text-xl font-medium text-[var(--neutral-900)] m-0">
                  {initial.attention?.title ?? "Drafting paused temporarily"}
                </h2>
                <p className="text-sm text-[var(--neutral-700)] leading-relaxed max-w-[60ch] m-0">
                  {initial.attention?.userMessage ??
                    "We ran into a temporary service issue while drafting this chapter. Your saved progress is intact and any reserved credits have been refunded. Please resume to try again."}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                {initial.attention?.kind === "user_input_required" ? (
                  <LinkButton href={`/projects/${initial.projectId}`} variant="primary">
                    Provide Details
                  </LinkButton>
                ) : (
                  <Button
                    type="button"
                    variant="primary"
                    loading={resuming}
                    loadingLabel="Resuming..."
                    onClick={handleResumeChapter}
                  >
                    Resume Chapter {initial.chapter.number}
                  </Button>
                )}
                <LinkButton href={`/projects/${initial.projectId}`} variant="secondary">
                  Back to project
                </LinkButton>
              </div>
            </div>
          ) : mode === "edit" ? (
            <div className="space-y-4">
              <p className="text-sm text-[var(--neutral-600)] m-0">
                Keep the bracketed citation markers intact so your references format automatically.
                Saving creates a new version and updates your project notes.
              </p>
              <textarea
                aria-label="Chapter markdown editor"
                rows={22}
                value={markdown}
                onChange={(e) => setMarkdown(e.target.value)}
                className="block w-full px-3.5 py-3 text-sm font-mono bg-[var(--neutral-50)] text-[var(--neutral-900)] border border-[var(--neutral-300)] rounded-[var(--radius-sm)] leading-relaxed"
              />
              <FormField
                id="edit-summary"
                label="Short edit note (optional)"
                type="text"
                placeholder="e.g. Clarified regional statistics in section 1.2"
                value={editSummary}
                onChange={(e) => setEditSummary(e.target.value)}
              />
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  loading={saving}
                  loadingLabel="Saving new version..."
                  onClick={handleSaveEdit}
                >
                  Save edits as new version
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setMarkdown(initial.markdown);
                    setMode("read");
                  }}
                >
                  Discard changes
                </Button>
              </div>
            </div>
          ) : !hasDraft ? (
            <p className="text-sm text-[var(--neutral-600)] m-0">
              {initial.chapter.status === "queued" || initial.chapter.status === "writing"
                ? "This chapter is currently being drafted. You will receive an email as soon as it is ready to review."
                : "No drafted text is stored for this chapter yet. Start the chapter from the project overview page."}
            </p>
          ) : (
            <article className="space-y-4 max-w-[68ch]">
              {blocks.map((block, idx) => {
                const trimmed = block.trim();
                if (trimmed.startsWith("# ")) {
                  return (
                    <h2 key={idx} className="text-2xl font-medium pt-2">
                      {trimmed.slice(2)}
                    </h2>
                  );
                }
                if (trimmed.startsWith("## ")) {
                  headingCounter++;
                  return (
                    <h3 key={idx} id={`sec-${headingCounter}`} className="text-xl font-medium pt-3">
                      {trimmed.slice(3)}
                    </h3>
                  );
                }
                if (trimmed.startsWith("### ")) {
                  headingCounter++;
                  return (
                    <h4
                      key={idx}
                      id={`sec-${headingCounter}`}
                      className="text-base font-semibold text-[var(--neutral-900)] pt-2"
                    >
                      {trimmed.slice(4)}
                    </h4>
                  );
                }
                if (trimmed.startsWith("|")) {
                  return (
                    <pre
                      key={idx}
                      className="overflow-x-auto text-xs bg-[var(--neutral-50)] border border-[var(--neutral-200)] rounded-[var(--radius-sm)] p-3"
                    >
                      {trimmed}
                    </pre>
                  );
                }
                return (
                  <p key={idx} className="text-base text-[var(--neutral-800)] leading-relaxed m-0">
                    {renderParagraphWithCitations(trimmed, citationByKey, setInspectedCitation)}
                  </p>
                );
              })}
            </article>
          )}
        </div>

        {/* Sidebar: Sections, Citation inspector, Similarity report, Versions */}
        <aside className="lg:col-span-4 space-y-4">
          {initial.headings.length > 0 ? (
            <section className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-5 space-y-2.5">
              <h2 className="text-base font-medium m-0">Sections</h2>
              <nav aria-label="Chapter sections">
                <ul className="space-y-1.5 list-none p-0 m-0 text-sm">
                  {initial.headings.map((h) => (
                    <li key={h.id} className={h.level === 3 ? "pl-3" : ""}>
                      <a
                        href={`#${h.id}`}
                        className="text-[var(--neutral-700)] hover:text-[var(--accent-600)] hover:underline underline-offset-4"
                      >
                        {h.text}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            </section>
          ) : null}

          <section className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-5 space-y-2.5">
            <h2 className="text-base font-medium m-0">Citation inspector</h2>
            {inspectedCitation ? (
              <div className="space-y-1 text-sm">
                <p className="text-xs font-semibold text-[var(--accent-600)] m-0">
                  Verified source
                </p>
                <p className="font-medium text-[var(--neutral-900)] m-0">
                  {inspectedCitation.title}
                </p>
                <p className="text-xs text-[var(--neutral-600)] m-0">
                  {inspectedCitation.venue ? `${inspectedCitation.venue} · ` : ""}
                  {inspectedCitation.year ?? "n.d."}
                </p>
                {inspectedCitation.doi ? (
                  <p className="text-xs text-[var(--neutral-600)] break-all m-0">
                    DOI: {inspectedCitation.doi}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-xs text-[var(--neutral-600)] leading-relaxed m-0">
                Hover over or click any citation in the chapter to view its verified source details.
              </p>
            )}
          </section>

          <section className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-5 space-y-2">
            <h2 className="text-base font-medium m-0">Verification &amp; similarity</h2>
            <p className="text-xs text-[var(--neutral-700)] tabular-nums m-0">
              Verified traceable claims: <strong>{initial.verifiedClaimsCount}</strong>
            </p>
            {initial.originalityReport ? (
              <div className="text-xs text-[var(--neutral-700)] tabular-nums space-y-1 pt-1">
                <p className="m-0">
                  Gate:{" "}
                  <strong
                    className={
                      initial.originalityReport.passed
                        ? "text-[var(--success-text)]"
                        : "text-[var(--error-text)]"
                    }
                  >
                    {initial.originalityReport.passed ? "Passed" : "Flagged"}
                  </strong>
                </p>
                <p className="m-0">Source overlap: {initial.originalityReport.overlapScore}%</p>
                <p className="m-0">Direct quotes: {initial.originalityReport.quoteSharePct}%</p>
                <p className="m-0">
                  Cross-user similarity: {initial.originalityReport.crossUserScore}%
                </p>
              </div>
            ) : (
              <p className="text-xs text-[var(--neutral-600)] m-0">
                Similarity metrics appear here once drafting completes.
              </p>
            )}
          </section>

          {initial.versions.length > 0 ? (
            <section className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-5 space-y-2">
              <h2 className="text-base font-medium m-0">Versions ({initial.versions.length})</h2>
              <ul className="space-y-1.5 list-none p-0 m-0 text-xs text-[var(--neutral-700)] tabular-nums">
                {initial.versions.slice(0, 6).map((v) => (
                  <li key={v.id}>
                    <strong>v{v.version}</strong> ({v.createdBy}) · {v.wordCount.toLocaleString()}w
                    · ~{v.pageCount}p
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
