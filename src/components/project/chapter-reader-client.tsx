"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  ChapterRichEditor,
  type ProjectFigureOption,
} from "@/components/project/chapter-rich-editor";
import { Button, LinkButton } from "@/components/ui/button";
import {
  DownloadMenuButton,
  type DownloadExportFormat,
} from "@/components/ui/download-menu-button";
import { FormField } from "@/components/ui/field";
import {
  InsufficientCreditsModal,
  type InsufficientCreditsDetails,
} from "@/components/ui/modal-card";
import { useToast } from "@/components/ui/toast";
import type { PageSize } from "@/db/schema";
import type { FormattedCitationCluster } from "@/lib/citations/reader-format";
import {
  computeControlledFigureDimensions,
  formatFigureAttributionForDisplay,
} from "@/lib/export/figure-layout";
import { getPageSizeSpec } from "@/lib/export/page-sizes";
import type { ChapterAttentionInfo } from "@/lib/writing/attention";
import { computeBlockPageNumbers, parseMarkdownToBlocks } from "@/lib/writing/editor-blocks";

export interface ReaderCitationCard {
  citeKey: string;
  inlineLabel?: string;
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
  projectTitle?: string;
  wordsPerPage?: number;
  pageSize?: PageSize;
  marginsMm?: number;
  chapter: {
    id: string;
    number: number;
    title: string;
    status: string;
  };
  attention?: ChapterAttentionInfo | null;
  markdown: string;
  headings: Array<{ id: string; text: string; level: number }>;
  citationClusters?: Record<string, FormattedCitationCluster>;
  citations: ReaderCitationCard[];
  projectFigures?: ProjectFigureOption[];
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

function formatVersionLabel(version: number, createdBy: string): string {
  if (version === 1 && createdBy !== "user") return "Original draft";
  if (createdBy === "user") return "Your edit";
  if (createdBy === "revision") return "Collate revision";
  return "Collate draft";
}

function renderInlineFormatting(text: string, keyPrefix: string): ReactNode[] {
  const segments = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return segments.map((seg, i) => {
    if (seg.startsWith("**") && seg.endsWith("**") && seg.length > 4) {
      return (
        <strong key={`${keyPrefix}-b-${i}`} className="font-semibold text-[var(--neutral-900)]">
          {seg.slice(2, -2)}
        </strong>
      );
    }
    if (seg.startsWith("*") && seg.endsWith("*") && seg.length > 2) {
      return <em key={`${keyPrefix}-i-${i}`}>{seg.slice(1, -1)}</em>;
    }
    return <span key={`${keyPrefix}-t-${i}`}>{seg}</span>;
  });
}

function renderParagraphWithCitations(
  text: string,
  citationByKey: Map<string, ReaderCitationCard>,
  citationClusters: Record<string, FormattedCitationCluster> | undefined,
  onInspect: (cards: ReaderCitationCard[]) => void
): ReactNode[] {
  const parts = text.split(/(\[@[^\]]+\])/g);
  return parts.map((part, idx) => {
    if (part.startsWith("[@") && part.endsWith("]")) {
      const cluster = citationClusters?.[part];
      const rawKeys =
        cluster?.citeKeys ??
        part
          .slice(1, -1)
          .split(";")
          .map((seg) => seg.trim().replace(/^@/, "").split(",")[0]?.trim() ?? "")
          .filter(Boolean);

      const cards = rawKeys
        .map((key) => citationByKey.get(key))
        .filter((c): c is ReaderCitationCard => Boolean(c));

      if (cards.length > 0) {
        const displayLabel =
          cluster?.label ??
          (cards.length === 1 && cards[0]?.inlineLabel ? cards[0].inlineLabel : part);
        const tooltip = cards.map((c) => `${c.title} (${c.year ?? "n.d."})`).join(" · ");

        return (
          <button
            key={idx}
            type="button"
            title={tooltip}
            onMouseEnter={() => onInspect(cards)}
            onFocus={() => onInspect(cards)}
            onClick={() => onInspect(cards)}
            className="inline px-1 py-[1px] text-[0.94em] font-normal rounded-[4px] bg-[var(--accent-100)]/75 hover:bg-[var(--accent-100)] text-[var(--accent-700)] transition-colors cursor-pointer [overflow-wrap:anywhere]"
          >
            {displayLabel}
          </button>
        );
      }
    }
    return <span key={idx}>{renderInlineFormatting(part, `p-${idx}`)}</span>;
  });
}

export function ChapterReaderClient({ initial }: { initial: ChapterReaderInitialData }) {
  const router = useRouter();
  const toast = useToast();
  const [mode, setMode] = useState<"read" | "edit">("read");
  const [markdown, setMarkdown] = useState(initial.markdown);
  const [editSummary, setEditSummary] = useState("");
  const [inspectedCitations, setInspectedCitations] = useState<ReaderCitationCard[]>(
    initial.citations[0] ? [initial.citations[0]] : []
  );
  const [saving, setSaving] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<DownloadExportFormat | null>(null);
  const [resuming, setResuming] = useState(false);
  const [creditsModal, setCreditsModal] = useState<InsufficientCreditsDetails | null>(null);
  const [previewVersion, setPreviewVersion] = useState<{
    version: ReaderVersionItem;
    markdown: string;
    citationClusters?: Record<string, FormattedCitationCluster>;
  } | null>(null);
  const [loadingVersionId, setLoadingVersionId] = useState<string | null>(null);
  const [restoringVersion, setRestoringVersion] = useState(false);
  const [pageSize, setPageSize] = useState<PageSize>(initial.pageSize ?? "a4");
  const [savingPageSize, setSavingPageSize] = useState(false);

  const citationByKey = new Map(initial.citations.map((c) => [c.citeKey, c]));
  const singleKeyLabels: Record<string, string> = {};
  for (const c of initial.citations) {
    if (c.inlineLabel) singleKeyLabels[c.citeKey] = c.inlineLabel;
  }
  const latestVersionId = initial.versions[0]?.id ?? null;
  const activeReadMarkdown = previewVersion ? previewVersion.markdown : markdown;
  const activeCitationClusters = previewVersion?.citationClusters ?? initial.citationClusters;
  const hasDraft = markdown.trim().length > 0;
  const isPausedWithoutDraft = initial.chapter.status === "needs_attention" && !hasDraft;
  const isInFlight = initial.chapter.status === "queued" || initial.chapter.status === "writing";

  useEffect(() => {
    if (!isInFlight) return;
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    }, 8000);
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isInFlight, router]);

  async function handleResumeChapter() {
    setResuming(true);
    try {
      const res = await fetch(
        `/api/projects/${initial.projectId}/chapters/${initial.chapter.id}/start`,
        { method: "POST" }
      );
      const data = (await res.json()) as {
        ok: boolean;
        code?: string;
        creditsRequired?: number;
        creditsAvailable?: number;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        if (
          (res.status === 402 || data.code === "INSUFFICIENT_CREDITS") &&
          typeof data.creditsRequired === "number"
        ) {
          setCreditsModal({
            actionLabel: `Chapter ${initial.chapter.number}: ${initial.chapter.title}`,
            creditsRequired: data.creditsRequired,
            creditsAvailable: data.creditsAvailable,
            message: data.error,
          });
          return;
        }
        toast.error(
          data.error ?? "Could not resume this chapter. Please try again.",
          "Could not resume chapter"
        );
        return;
      }
      toast.success(
        "Chapter queued for drafting. You will receive an email as soon as it is ready to review.",
        "Chapter queued"
      );
      router.refresh();
    } catch {
      toast.error("Network error while resuming chapter.", "Connection error");
    } finally {
      setResuming(false);
    }
  }

  async function handleSaveEdit() {
    if (markdown.trim().length < 20) {
      toast.error("Chapter text is too short to save.", "More text required");
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
        toast.error(data.error ?? "Could not save your chapter edits.", "Could not save changes");
        return;
      }
      setEditSummary("");
      setMode("read");
      toast.success(
        `Saved version ${data.version?.version ?? ""} and updated your project notes for later chapters.`,
        "Changes saved"
      );
      router.refresh();
    } catch {
      toast.error("Network error while saving edits.", "Connection error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDownloadChapter(format: DownloadExportFormat) {
    setExportingFormat(format);
    try {
      const res = await fetch(`/api/projects/${initial.projectId}/exports`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scope: "chapter",
          format,
          chapterId: initial.chapter.id,
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        export?: { downloadUrl: string };
        error?: string;
      };
      if (!res.ok || !data.ok || !data.export?.downloadUrl) {
        toast.error(
          data.error ??
            (format === "docx"
              ? "Could not generate chapter Word document."
              : "Could not generate chapter PDF."),
          "Download unavailable"
        );
        return;
      }
      window.location.href = data.export.downloadUrl;
    } catch {
      toast.error(
        format === "docx"
          ? "Network error while building chapter Word document."
          : "Network error while building chapter PDF.",
        "Download unavailable"
      );
    } finally {
      setExportingFormat(null);
    }
  }

  async function handleSelectHistoryVersion(versionItem: ReaderVersionItem) {
    if (versionItem.id === latestVersionId) {
      setPreviewVersion(null);
      return;
    }
    setLoadingVersionId(versionItem.id);
    try {
      const res = await fetch(
        `/api/projects/${initial.projectId}/chapters/${initial.chapter.id}?versionId=${encodeURIComponent(versionItem.id)}`
      );
      const data = (await res.json()) as {
        ok: boolean;
        markdown?: string;
        citationClusters?: Record<string, FormattedCitationCluster>;
        error?: string;
      };
      if (!res.ok || !data.ok || typeof data.markdown !== "string") {
        toast.error(data.error ?? "Could not load that draft version.", "Draft unavailable");
        return;
      }
      setMode("read");
      setPreviewVersion({
        version: versionItem,
        markdown: data.markdown,
        citationClusters: data.citationClusters,
      });
    } catch {
      toast.error("Network error while loading draft version.", "Connection error");
    } finally {
      setLoadingVersionId(null);
    }
  }

  async function handleChangePageSize(nextSize: PageSize) {
    if (nextSize === pageSize) return;
    const prevSize = pageSize;
    setPageSize(nextSize);
    setSavingPageSize(true);
    try {
      const res = await fetch(`/api/projects/${initial.projectId}/settings`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pageSize: nextSize }),
      });
      const data = (await res.json()) as { ok: boolean; pageSize?: PageSize; error?: string };
      if (!res.ok || !data.ok) {
        setPageSize(prevSize);
        toast.error(
          data.error ?? "Could not update the document page size. Please try again.",
          "Update failed"
        );
        return;
      }
      const label = getPageSizeSpec(nextSize).shortLabel;
      toast.success(
        `Document page size updated to ${label} for the entire project (PDF and Word exports).`,
        "Page size saved"
      );
      router.refresh();
    } catch {
      setPageSize(prevSize);
      toast.error("Network error while saving document page size.", "Connection error");
    } finally {
      setSavingPageSize(false);
    }
  }

  async function handleRestorePreviewVersion() {
    if (!previewVersion) return;
    setRestoringVersion(true);
    try {
      const res = await fetch(`/api/projects/${initial.projectId}/chapters/${initial.chapter.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          markdown: previewVersion.markdown,
          editSummary: `Restored from Version ${previewVersion.version.version}`,
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        version?: { version: number };
        error?: string;
      };
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? "Could not restore this draft.", "Restore failed");
        return;
      }
      setMarkdown(previewVersion.markdown);
      setPreviewVersion(null);
      setMode("read");
      toast.success(
        `Restored Version ${previewVersion.version.version} as Version ${data.version?.version ?? ""}.`,
        "Draft restored"
      );
      router.refresh();
    } catch {
      toast.error("Network error while restoring draft.", "Connection error");
    } finally {
      setRestoringVersion(false);
    }
  }

  let headingCounter = 0;
  let lastShownPage = 0;
  const parsedReadBlocks = parseMarkdownToBlocks(activeReadMarkdown);
  const readPageNumbers = computeBlockPageNumbers(parsedReadBlocks, initial.wordsPerPage ?? 275);
  const pageTitleLower = `chapter ${initial.chapter.number}: ${initial.chapter.title}`
    .trim()
    .toLowerCase();

  return (
    <div className="flex flex-col gap-6">
      {!isPausedWithoutDraft ? (
        <div className="flex items-center justify-between gap-2 sm:gap-3">
          <div
            role="tablist"
            aria-label="Chapter view mode"
            className="inline-flex items-center p-1 rounded-[var(--radius-sm)] bg-[var(--neutral-100)] border border-[var(--neutral-200)] shrink-0"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === "read"}
              disabled={!hasDraft}
              onClick={() => setMode("read")}
              className={`min-h-[34px] px-3 sm:px-3.5 py-1.5 text-sm font-medium rounded-[4px] whitespace-nowrap transition-colors cursor-pointer disabled:opacity-50 ${
                mode === "read"
                  ? "bg-[var(--accent-600)] text-white shadow-xs"
                  : "text-[var(--neutral-700)] hover:text-[var(--neutral-900)]"
              }`}
            >
              Read<span className="hidden sm:inline"> Chapter</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "edit"}
              disabled={!hasDraft}
              onClick={() => {
                setPreviewVersion(null);
                setMode("edit");
              }}
              className={`min-h-[34px] px-3 sm:px-3.5 py-1.5 text-sm font-medium rounded-[4px] whitespace-nowrap transition-colors cursor-pointer disabled:opacity-50 ${
                mode === "edit"
                  ? "bg-[var(--accent-600)] text-white shadow-xs"
                  : "text-[var(--neutral-700)] hover:text-[var(--neutral-900)]"
              }`}
            >
              Light edit
            </button>
          </div>

          <DownloadMenuButton
            label="Download"
            disabled={!hasDraft}
            loadingFormat={exportingFormat}
            onSelectFormat={handleDownloadChapter}
            align="right"
            className="shrink-0"
          />
        </div>
      ) : null}

      {initial.chapter.status === "needs_attention" && hasDraft && initial.attention ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--warning-border)] bg-[var(--warning-bg)] p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex flex-col gap-1.5 text-sm text-[var(--warning-text)]">
            <p className="font-semibold">{initial.attention.title}</p>
            <p className="leading-relaxed">{initial.attention.userMessage}</p>
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

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Main reader / editor pane */}
        <div className="xl:col-span-8 bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-5 sm:p-8 flex flex-col gap-5">
          {isPausedWithoutDraft ? (
            <div className="flex flex-col gap-5 py-2">
              <div className="flex flex-col gap-2">
                <span className="self-start inline-flex items-center px-2.5 py-0.5 text-xs font-medium border rounded-[4px] bg-[var(--warning-bg)] text-[var(--warning-text)] border-[var(--warning-border)]">
                  Needs Attention
                </span>
                <h2 className="text-xl font-medium text-[var(--neutral-900)]">
                  {initial.attention?.title ?? "Drafting paused temporarily"}
                </h2>
                <p className="text-sm text-[var(--neutral-700)] leading-relaxed max-w-[60ch]">
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
            <div className="flex flex-col gap-4">
              <ChapterRichEditor
                projectId={initial.projectId}
                projectTitle={initial.projectTitle ?? initial.chapter.title}
                markdown={markdown}
                wordsPerPage={initial.wordsPerPage ?? 275}
                pageSize={pageSize}
                marginsMm={initial.marginsMm ?? 25}
                savingPageSize={savingPageSize}
                onChangePageSize={(next) => void handleChangePageSize(next)}
                citationClusters={initial.citationClusters}
                singleKeyLabels={singleKeyLabels}
                initialFigures={initial.projectFigures ?? []}
                onChange={setMarkdown}
              />
              <FormField
                id="edit-summary"
                label="Short edit note (optional)"
                type="text"
                placeholder="e.g. Added beetroot figure and clarified section 1.2"
                value={editSummary}
                onChange={(e) => setEditSummary(e.target.value)}
              />
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Button
                  type="button"
                  loading={saving}
                  loadingLabel="Saving new draft..."
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
            <p className="text-sm text-[var(--neutral-600)]">
              {initial.chapter.status === "queued" || initial.chapter.status === "writing"
                ? "This chapter is currently being drafted. You will receive an email as soon as it is ready to review."
                : "No drafted text is stored for this chapter yet. Start the chapter from the project overview page."}
            </p>
          ) : (
            <div className="flex flex-col gap-5">
              {previewVersion ? (
                <div className="rounded-[var(--radius-sm)] border border-[var(--info-border)] bg-[var(--info-bg)] px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex flex-col gap-0.5 text-xs text-[var(--info-text)]">
                    <p className="font-semibold">
                      Viewing Version {previewVersion.version.version} (
                      {formatVersionLabel(
                        previewVersion.version.version,
                        previewVersion.version.createdBy
                      )}
                      ) · read-only preview
                    </p>
                    {previewVersion.version.revisionNotes ? (
                      <p className="opacity-90">{previewVersion.version.revisionNotes}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <Button
                      type="button"
                      variant="primary"
                      loading={restoringVersion}
                      loadingLabel="Restoring..."
                      onClick={() => void handleRestorePreviewVersion()}
                    >
                      Restore this version
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setPreviewVersion(null)}
                    >
                      Back to latest
                    </Button>
                  </div>
                </div>
              ) : null}

              <article className="flex flex-col gap-4 max-w-[68ch]">
                {parsedReadBlocks.map((block, idx) => {
                  // Page break bars belong strictly in Light edit; Read mode keeps subtle page indicators only.
                  if (block.type === "page_break") {
                    return null;
                  }

                  if (
                    block.type === "heading" &&
                    block.level === 1 &&
                    block.text.trim().toLowerCase() === pageTitleLower
                  ) {
                    return null;
                  }

                  const pageNum = readPageNumbers[idx] ?? 1;
                  const showPageMarker = pageNum !== lastShownPage;
                  if (showPageMarker) {
                    lastShownPage = pageNum;
                  }

                  const pageDivider = showPageMarker ? (
                    <div
                      key={`pg-${pageNum}-${idx}`}
                      className={`flex items-center gap-2.5 ${idx > 0 ? "pt-3" : ""}`}
                    >
                      <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--neutral-500)] tabular-nums">
                        ~Page {pageNum}
                      </span>
                      <span className="h-px flex-1 bg-[var(--neutral-100)]" aria-hidden="true" />
                    </div>
                  ) : null;

                  let blockNode: ReactNode;

                  if (block.type === "heading") {
                    if (block.level === 1) {
                      blockNode = (
                        <h2
                          key={block.id}
                          className="text-2xl font-medium leading-snug text-[var(--neutral-900)] mt-2 first:mt-0"
                        >
                          {renderInlineFormatting(block.text, `h1-${idx}`)}
                        </h2>
                      );
                    } else if (block.level === 2) {
                      headingCounter++;
                      blockNode = (
                        <h3
                          key={block.id}
                          id={`sec-${headingCounter}`}
                          className="text-xl font-medium leading-snug text-[var(--neutral-900)] mt-4 first:mt-0"
                        >
                          {renderInlineFormatting(block.text, `h2-${idx}`)}
                        </h3>
                      );
                    } else if (block.level === 3) {
                      headingCounter++;
                      blockNode = (
                        <h4
                          key={block.id}
                          id={`sec-${headingCounter}`}
                          className="text-base font-semibold leading-snug text-[var(--neutral-900)] mt-2 first:mt-0"
                        >
                          {renderInlineFormatting(block.text, `h3-${idx}`)}
                        </h4>
                      );
                    } else {
                      headingCounter++;
                      blockNode = (
                        <h5
                          key={block.id}
                          id={`sec-${headingCounter}`}
                          className="text-[0.9375rem] font-semibold leading-snug text-[var(--neutral-800)] mt-2 first:mt-0"
                        >
                          {renderInlineFormatting(block.text, `h4-${idx}`)}
                        </h5>
                      );
                    }
                  } else if (block.type === "figure") {
                    const dims = computeControlledFigureDimensions(
                      block.figure.width,
                      block.figure.height
                    );
                    const matchedFigureSourceUrl =
                      block.figure.sourceUrl ??
                      initial.projectFigures?.find((f) => f.url === block.figure.url)
                        ?.sourcePageUrl;
                    const formattedAttr = formatFigureAttributionForDisplay(
                      block.figure.attribution,
                      matchedFigureSourceUrl
                    );
                    blockNode = (
                      <figure
                        key={block.id}
                        className="my-2 w-full flex flex-col items-center gap-2.5 p-3 sm:p-4 rounded-[var(--radius-sm)] border border-[var(--neutral-200)] bg-[var(--neutral-50)]/50 overflow-hidden"
                      >
                        <img
                          src={block.figure.url}
                          alt={block.figure.alt}
                          style={{
                            maxWidth: `min(100%, ${dims.widthPx}px)`,
                            maxHeight: `${dims.heightPx}px`,
                          }}
                          className="w-auto h-auto object-contain rounded-[4px]"
                        />
                        <figcaption className="w-full min-w-0 flex flex-col items-center gap-1 text-center max-w-[58ch]">
                          <span className="w-full text-sm font-medium text-[var(--neutral-800)] leading-snug [overflow-wrap:anywhere]">
                            {renderInlineFormatting(block.figure.caption, `figcap-${idx}`)}
                          </span>
                          {formattedAttr.displayText ? (
                            <span className="w-full text-[11px] text-[var(--neutral-500)] leading-relaxed [overflow-wrap:anywhere]">
                              {formattedAttr.linkSegments ? (
                                <>
                                  {formattedAttr.linkSegments.before}
                                  <a
                                    href={formattedAttr.linkSegments.href}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="underline decoration-[var(--neutral-300)] hover:decoration-[var(--accent-600)] hover:text-[var(--accent-600)] underline-offset-2 transition-colors"
                                  >
                                    {formattedAttr.linkSegments.label}
                                  </a>
                                  {formattedAttr.linkSegments.after}
                                </>
                              ) : (
                                formattedAttr.displayText
                              )}
                            </span>
                          ) : null}
                        </figcaption>
                      </figure>
                    );
                  } else if (block.type === "table") {
                    blockNode = (
                      <pre
                        key={block.id}
                        className="overflow-x-auto text-xs bg-[var(--neutral-50)] border border-[var(--neutral-200)] rounded-[var(--radius-sm)] p-3"
                      >
                        {block.raw}
                      </pre>
                    );
                  } else if (block.type === "bullet_list") {
                    blockNode = (
                      <ul
                        key={block.id}
                        className="list-disc pl-5 flex flex-col gap-2 text-base text-[var(--neutral-800)] leading-[1.7]"
                      >
                        {block.items.map((item, liIdx) => (
                          <li key={liIdx}>
                            {renderParagraphWithCitations(
                              item,
                              citationByKey,
                              activeCitationClusters,
                              setInspectedCitations
                            )}
                          </li>
                        ))}
                      </ul>
                    );
                  } else if (block.type === "blockquote") {
                    blockNode = (
                      <blockquote
                        key={block.id}
                        className="pl-4 border-l-2 border-[var(--neutral-300)] text-base text-[var(--neutral-700)] italic leading-[1.75]"
                      >
                        {renderParagraphWithCitations(
                          block.text,
                          citationByKey,
                          activeCitationClusters,
                          setInspectedCitations
                        )}
                      </blockquote>
                    );
                  } else if (block.text.trim().length === 0) {
                    blockNode = <div key={block.id} aria-hidden="true" className="h-[1.75rem]" />;
                  } else {
                    blockNode = (
                      <p
                        key={block.id}
                        className="text-base text-[var(--neutral-800)] leading-[1.75]"
                      >
                        {renderParagraphWithCitations(
                          block.text,
                          citationByKey,
                          activeCitationClusters,
                          setInspectedCitations
                        )}
                      </p>
                    );
                  }

                  return pageDivider ? (
                    <div key={`wrap-${block.id}`} className="flex flex-col gap-3">
                      {pageDivider}
                      {blockNode}
                    </div>
                  ) : (
                    blockNode
                  );
                })}
              </article>
            </div>
          )}
        </div>

        {/* Sidebar: Sections, Citation inspector, Originality & checks, Draft history */}
        <aside className="xl:col-span-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-5 items-start">
          {initial.headings.length > 0 ? (
            <section className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-5 sm:p-6 flex flex-col gap-3.5">
              <h2 className="text-base font-semibold text-[var(--neutral-900)]">Sections</h2>
              <nav aria-label="Chapter sections">
                <ul className="flex flex-col gap-2.5 list-none p-0 text-sm leading-snug">
                  {initial.headings.map((h) => (
                    <li
                      key={h.id}
                      className={
                        h.level === 3
                          ? "pl-3"
                          : h.level >= 4
                            ? "pl-6 text-xs text-[var(--neutral-600)]"
                            : ""
                      }
                    >
                      <a
                        href={`#${h.id}`}
                        className="text-[var(--neutral-700)] hover:text-[var(--accent-600)] hover:underline underline-offset-4"
                      >
                        {renderInlineFormatting(h.text, `toc-${h.id}`)}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            </section>
          ) : null}

          <section className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-5 sm:p-6 flex flex-col gap-4">
            <h2 className="text-base font-semibold text-[var(--neutral-900)]">
              Citation inspector
            </h2>
            {inspectedCitations.length > 0 ? (
              <div className="flex flex-col gap-4 divide-y divide-[var(--neutral-100)]">
                {inspectedCitations.map((citation, idx) => (
                  <div
                    key={citation.citeKey}
                    className={`flex flex-col gap-3 text-sm ${idx > 0 ? "pt-4" : ""}`}
                  >
                    <span className="self-start inline-flex items-center px-2 py-0.5 text-[11px] font-semibold rounded-[4px] bg-[var(--accent-100)] text-[var(--accent-700)]">
                      Verified source
                    </span>
                    <p className="text-[0.9375rem] font-medium text-[var(--neutral-900)] leading-snug [overflow-wrap:anywhere]">
                      {citation.title}
                    </p>
                    <div className="pt-2.5 border-t border-[var(--neutral-100)] flex flex-col gap-1.5 text-xs text-[var(--neutral-600)]">
                      <p>
                        {citation.venue ? `${citation.venue} · ` : ""}
                        {citation.year ?? "n.d."}
                      </p>
                      {citation.doi ? (
                        <p className="break-all text-[var(--neutral-500)]">DOI: {citation.doi}</p>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-[var(--neutral-600)] leading-relaxed">
                Hover over or click any citation in the chapter to view its verified source details.
              </p>
            )}
          </section>

          <section className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-5 sm:p-6 flex flex-col gap-4">
            <h2 className="text-base font-semibold text-[var(--neutral-900)]">
              Originality &amp; checks
            </h2>
            {initial.originalityReport ? (
              <dl className="flex flex-col gap-2.5 text-xs tabular-nums">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-[var(--neutral-600)]">Originality check</dt>
                  <dd>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 text-[11px] font-semibold rounded-[4px] border ${
                        initial.originalityReport.passed
                          ? "bg-[var(--success-bg)] text-[var(--success-text)] border-[var(--success-border)]"
                          : "bg-[var(--error-bg)] text-[var(--error-text)] border-[var(--error-border)]"
                      }`}
                    >
                      {initial.originalityReport.passed ? "Passed" : "Needs review"}
                    </span>
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-[var(--neutral-600)]">Matched source text</dt>
                  <dd className="font-semibold text-[var(--neutral-900)]">
                    {initial.originalityReport.overlapScore}%
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-[var(--neutral-600)]">Direct quotes</dt>
                  <dd className="font-semibold text-[var(--neutral-900)]">
                    {initial.originalityReport.quoteSharePct}%
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-[var(--neutral-600)]">Shared across projects</dt>
                  <dd className="font-semibold text-[var(--neutral-900)]">
                    {initial.originalityReport.crossUserScore}%
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 pt-2.5 border-t border-[var(--neutral-100)]">
                  <dt className="text-[var(--neutral-600)]">Verified claims</dt>
                  <dd className="font-semibold text-[var(--neutral-900)]">
                    {initial.verifiedClaimsCount}
                  </dd>
                </div>
              </dl>
            ) : (
              <div className="flex flex-col gap-2 text-xs text-[var(--neutral-600)] tabular-nums">
                <p>
                  Verified claims:{" "}
                  <strong className="text-[var(--neutral-900)]">
                    {initial.verifiedClaimsCount}
                  </strong>
                </p>
                <p className="leading-relaxed">
                  Originality checks appear here once drafting completes.
                </p>
              </div>
            )}
          </section>

          {initial.versions.length > 0 ? (
            <section className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-5 sm:p-6 flex flex-col gap-3.5">
              <div className="flex flex-col gap-1">
                <h2 className="text-base font-semibold text-[var(--neutral-900)]">
                  Draft history ({initial.versions.length})
                </h2>
                <p className="text-xs text-[var(--neutral-500)]">
                  Every save and revision is preserved. Select a draft to preview or restore.
                </p>
              </div>
              <ul className="flex flex-col gap-2 list-none p-0 text-xs tabular-nums">
                {initial.versions.slice(0, 8).map((v) => {
                  const isCurrent = v.id === latestVersionId;
                  const isSelected = previewVersion
                    ? previewVersion.version.id === v.id
                    : isCurrent;
                  const isLoading = loadingVersionId === v.id;

                  return (
                    <li key={v.id}>
                      <button
                        type="button"
                        disabled={isLoading}
                        onClick={() => void handleSelectHistoryVersion(v)}
                        className={`w-full text-left px-3 py-2.5 rounded-[var(--radius-sm)] border transition-colors flex flex-col gap-1 cursor-pointer ${
                          isSelected
                            ? "border-[var(--accent-600)]/40 bg-[var(--accent-100)]/35"
                            : "border-[var(--neutral-200)] bg-white hover:bg-[var(--neutral-50)]"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-[var(--neutral-900)]">
                            Version {v.version} · {formatVersionLabel(v.version, v.createdBy)}
                          </span>
                          {isCurrent ? (
                            <span className="px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide rounded-[4px] bg-[var(--accent-100)] text-[var(--accent-700)]">
                              Current
                            </span>
                          ) : isLoading ? (
                            <span className="text-[11px] text-[var(--neutral-500)]">
                              Loading...
                            </span>
                          ) : null}
                        </div>
                        <span className="text-[var(--neutral-600)]">
                          {v.wordCount.toLocaleString()} words · ~{v.pageCount}{" "}
                          {v.pageCount === 1 ? "page" : "pages"}
                        </span>
                        {v.revisionNotes ? (
                          <span className="text-[11px] text-[var(--neutral-500)] line-clamp-1">
                            {v.revisionNotes}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </aside>
      </div>

      <InsufficientCreditsModal details={creditsModal} onClose={() => setCreditsModal(null)} />
    </div>
  );
}
