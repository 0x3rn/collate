"use client";

import { useEffect, useRef, useState } from "react";
import { SearchIcon } from "@/components/layout/workspace-icons";
import { Button } from "@/components/ui/button";
import { ModalCard } from "@/components/ui/modal-card";
import { useToast } from "@/components/ui/toast";
import type { FormattedCitationCluster } from "@/lib/citations/reader-format";
import { computeControlledFigureDimensions } from "@/lib/export/figure-layout";
import {
  computeBlockPageNumbers,
  inlineMarkdownToEditableHtml,
  parseMarkdownToBlocks,
  serializeBlocksToMarkdown,
  serializeEditableNodeToMarkdown,
  type AcademicFigureData,
  type ChapterDocBlock,
} from "@/lib/writing/editor-blocks";

export interface ProjectFigureOption {
  id: string;
  url: string;
  sourcePageUrl: string;
  title: string;
  alt: string;
  caption: string;
  attribution: string;
  license: string;
  naturalWidth: number;
  naturalHeight: number;
}

function InlineEditableBlock({
  value,
  citationClusters,
  singleKeyLabels,
  className,
  ariaLabel,
  onFocusBlock,
  onChangeMarkdown,
}: {
  value: string;
  citationClusters?: Record<string, FormattedCitationCluster>;
  singleKeyLabels?: Record<string, string>;
  className: string;
  ariaLabel: string;
  onFocusBlock: () => void;
  onChangeMarkdown: (next: string) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const lastCommittedRef = useRef<string>(value);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Only overwrite innerHTML when value changed externally (initial mount or mode/block switch)
    if (value !== lastCommittedRef.current || el.innerHTML === "") {
      el.innerHTML = inlineMarkdownToEditableHtml(value, citationClusters, singleKeyLabels);
      lastCommittedRef.current = value;
    }
  }, [value, citationClusters, singleKeyLabels]);

  function handleSync() {
    const el = ref.current;
    if (!el) return;
    const nextMd = serializeEditableNodeToMarkdown(el);
    lastCommittedRef.current = nextMd;
    onChangeMarkdown(nextMd);
  }

  return (
    <div
      ref={ref}
      role="textbox"
      aria-multiline="true"
      aria-label={ariaLabel}
      contentEditable
      suppressContentEditableWarning
      onFocus={onFocusBlock}
      onInput={handleSync}
      onBlur={handleSync}
      className={className}
    />
  );
}

export function ChapterRichEditor({
  projectId,
  projectTitle,
  markdown,
  wordsPerPage,
  citationClusters,
  singleKeyLabels,
  initialFigures,
  onChange,
}: {
  projectId: string;
  projectTitle: string;
  markdown: string;
  wordsPerPage: number;
  citationClusters?: Record<string, FormattedCitationCluster>;
  singleKeyLabels?: Record<string, string>;
  initialFigures: ProjectFigureOption[];
  onChange: (nextMarkdown: string) => void;
}) {
  const toast = useToast();
  const [rawMode, setRawMode] = useState(false);
  const [blocks, setBlocks] = useState<ChapterDocBlock[]>(() => parseMarkdownToBlocks(markdown));
  const [activeIndex, setActiveIndex] = useState<number>(0);

  // Verified academic image picker modal state
  const [figureModalOpen, setFigureModalOpen] = useState(false);
  const [figureQuery, setFigureQuery] = useState(projectTitle.slice(0, 70));
  const [searchingFigures, setSearchingFigures] = useState(false);
  const [projectFigures, setProjectFigures] = useState<ProjectFigureOption[]>(initialFigures);
  const [searchResults, setSearchResults] = useState<ProjectFigureOption[]>([]);

  const lastSerializedRef = useRef<string>(markdown);

  useEffect(() => {
    if (markdown !== lastSerializedRef.current) {
      setBlocks(parseMarkdownToBlocks(markdown));
      lastSerializedRef.current = markdown;
    }
  }, [markdown]);

  function commitBlocks(nextBlocks: ChapterDocBlock[]) {
    setBlocks(nextBlocks);
    const serialized = serializeBlocksToMarkdown(nextBlocks);
    lastSerializedRef.current = serialized;
    onChange(serialized);
  }

  function updateBlock(index: number, updater: (block: ChapterDocBlock) => ChapterDocBlock) {
    const next = blocks.map((b, idx) => (idx === index ? updater(b) : b));
    commitBlocks(next);
  }

  function insertBlockAfterActive(newBlock: ChapterDocBlock) {
    const insertAt = Math.min(blocks.length, Math.max(0, activeIndex + 1));
    const next = [...blocks.slice(0, insertAt), newBlock, ...blocks.slice(insertAt)];
    commitBlocks(next);
    setActiveIndex(insertAt);
  }

  function removeBlock(index: number) {
    const next = blocks.filter((_, idx) => idx !== index);
    commitBlocks(next);
    setActiveIndex(Math.max(0, index - 1));
  }

  function moveBlock(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved!);
    commitBlocks(next);
    setActiveIndex(target);
  }

  function applyInlineCommand(command: "bold" | "italic") {
    if (typeof document !== "undefined") {
      document.execCommand(command, false);
    }
  }

  async function handleSearchVerifiedImages() {
    const trimmed = figureQuery.trim();
    if (trimmed.length < 2) {
      toast.error(
        "Enter a topic or object to search (e.g. Beta vulgaris beetroot).",
        "Search term needed"
      );
      return;
    }
    setSearchingFigures(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/figures/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: trimmed, limit: 6 }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        figures?: ProjectFigureOption[];
        error?: string;
      };
      if (!res.ok || !data.ok) {
        toast.error(
          data.error ?? "Could not search verified images right now.",
          "Image search failed"
        );
        return;
      }
      const list = data.figures ?? [];
      setSearchResults(list);
      if (list.length > 0) {
        setProjectFigures((prev) => {
          const existingUrls = new Set(prev.map((f) => f.url));
          return [...list.filter((f) => !existingUrls.has(f.url)), ...prev];
        });
      } else {
        toast.info(
          "No openly licensed images matched that exact term. Try simpler keywords like 'Beta vulgaris' or 'beetroot'.",
          "No images found"
        );
      }
    } catch {
      toast.error("Network error while searching verified academic images.", "Connection error");
    } finally {
      setSearchingFigures(false);
    }
  }

  function handleInsertFigureOption(fig: ProjectFigureOption) {
    const figureData: AcademicFigureData = {
      url: fig.url,
      alt: fig.alt || fig.title,
      caption: fig.caption || fig.title,
      attribution: fig.attribution,
      width: fig.naturalWidth,
      height: fig.naturalHeight,
    };
    insertBlockAfterActive({
      id: `blk_fig_${Date.now()}`,
      type: "figure",
      figure: figureData,
    });
    setFigureModalOpen(false);
    toast.success("Verified figure inserted with proper license attribution.", "Figure added");
  }

  const pageNumbers = computeBlockPageNumbers(blocks, wordsPerPage);
  const displayedFigureOptions = searchResults.length > 0 ? searchResults : projectFigures;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-[var(--neutral-600)] leading-relaxed m-0">
        Edit your chapter directly below. Blue citations stay locked automatically so your reference
        list never breaks. Saving creates a new draft in your history.
      </p>

      {/* Clean student-friendly formatting toolbar */}
      <div
        role="toolbar"
        aria-label="Chapter formatting toolbar"
        className="sticky top-[64px] lg:top-3 z-20 flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-[var(--neutral-50)] border border-[var(--neutral-200)] rounded-[var(--radius-sm)]"
      >
        {!rawMode ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              title="Bold selected text"
              onMouseDown={(e) => {
                e.preventDefault();
                applyInlineCommand("bold");
              }}
              className="px-2.5 py-1.5 text-xs font-bold text-[var(--neutral-800)] bg-white border border-[var(--neutral-200)] rounded-[4px] hover:bg-[var(--neutral-100)] cursor-pointer"
            >
              B
            </button>
            <button
              type="button"
              title="Italicize selected text"
              onMouseDown={(e) => {
                e.preventDefault();
                applyInlineCommand("italic");
              }}
              className="px-2.5 py-1.5 text-xs italic font-serif text-[var(--neutral-800)] bg-white border border-[var(--neutral-200)] rounded-[4px] hover:bg-[var(--neutral-100)] cursor-pointer"
            >
              I
            </button>

            <span aria-hidden="true" className="w-px h-5 bg-[var(--neutral-200)] mx-1" />

            <button
              type="button"
              onClick={() =>
                insertBlockAfterActive({
                  id: `blk_p_${Date.now()}`,
                  type: "paragraph",
                  text: "Write your paragraph here.",
                })
              }
              className="px-2.5 py-1.5 text-xs font-medium text-[var(--neutral-700)] bg-white border border-[var(--neutral-200)] rounded-[4px] hover:bg-[var(--neutral-100)] cursor-pointer"
            >
              + Paragraph
            </button>
            <button
              type="button"
              onClick={() =>
                insertBlockAfterActive({
                  id: `blk_h2_${Date.now()}`,
                  type: "heading",
                  level: 2,
                  text: "New section heading",
                })
              }
              className="px-2.5 py-1.5 text-xs font-medium text-[var(--neutral-700)] bg-white border border-[var(--neutral-200)] rounded-[4px] hover:bg-[var(--neutral-100)] cursor-pointer"
            >
              + Heading
            </button>
            <button
              type="button"
              onClick={() =>
                insertBlockAfterActive({
                  id: `blk_ul_${Date.now()}`,
                  type: "bullet_list",
                  items: ["List item"],
                })
              }
              className="px-2.5 py-1.5 text-xs font-medium text-[var(--neutral-700)] bg-white border border-[var(--neutral-200)] rounded-[4px] hover:bg-[var(--neutral-100)] cursor-pointer"
            >
              + List
            </button>
            <button
              type="button"
              onClick={() =>
                insertBlockAfterActive({
                  id: `blk_pb_${Date.now()}`,
                  type: "page_break",
                })
              }
              className="px-2.5 py-1.5 text-xs font-medium text-[var(--accent-700)] bg-white border border-[var(--neutral-200)] rounded-[4px] hover:bg-[var(--accent-100)]/60 cursor-pointer"
            >
              + Page break
            </button>
            <button
              type="button"
              onClick={() => setFigureModalOpen(true)}
              className="px-2.5 py-1.5 text-xs font-medium text-[var(--accent-700)] bg-white border border-[var(--neutral-200)] rounded-[4px] hover:bg-[var(--accent-100)]/60 cursor-pointer"
            >
              + Verified image
            </button>
          </div>
        ) : (
          <span className="text-xs font-medium text-[var(--neutral-600)]">
            Markdown source mode
          </span>
        )}

        <button
          type="button"
          onClick={() => setRawMode((prev) => !prev)}
          className="px-2.5 py-1.5 text-xs font-medium text-[var(--neutral-600)] hover:text-[var(--neutral-900)] hover:bg-[var(--neutral-100)] rounded-[4px] transition-colors cursor-pointer"
        >
          {rawMode ? "Back to formatted view" : "Markdown source"}
        </button>
      </div>

      {rawMode ? (
        <textarea
          aria-label="Chapter markdown editor"
          rows={22}
          value={markdown}
          onChange={(e) => {
            lastSerializedRef.current = e.target.value;
            setBlocks(parseMarkdownToBlocks(e.target.value));
            onChange(e.target.value);
          }}
          className="block w-full px-3.5 py-3 text-sm font-mono bg-[var(--neutral-50)] text-[var(--neutral-900)] border border-[var(--neutral-300)] rounded-[var(--radius-sm)] leading-relaxed"
        />
      ) : (
        <div className="flex flex-col gap-3">
          {blocks.map((block, idx) => {
            const pageNum = pageNumbers[idx] ?? 1;
            const prevPageNum = idx > 0 ? (pageNumbers[idx - 1] ?? 1) : 0;
            const showPageBadge = block.type !== "page_break" && pageNum !== prevPageNum;
            const isActive = idx === activeIndex;

            return (
              <div key={block.id} className="flex flex-col gap-2">
                {showPageBadge ? (
                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-[4px] bg-[var(--neutral-100)] text-[var(--neutral-600)] border border-[var(--neutral-200)] tabular-nums">
                      ~Page {pageNum}
                    </span>
                    <span className="h-px flex-1 bg-[var(--neutral-100)]" aria-hidden="true" />
                  </div>
                ) : null}

                {block.type === "page_break" ? (
                  <div
                    onClick={() => setActiveIndex(idx)}
                    className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-[var(--radius-sm)] border border-dashed border-[var(--accent-600)]/50 bg-[var(--accent-100)]/30 text-xs text-[var(--accent-700)]"
                  >
                    <span className="font-medium">
                      Page break — content below starts on Page {pageNum + 1} in PDF &amp; Word
                    </span>
                    <button
                      type="button"
                      onClick={() => removeBlock(idx)}
                      className="text-xs font-medium text-[var(--neutral-600)] hover:text-[var(--error-text)] cursor-pointer"
                    >
                      Remove
                    </button>
                  </div>
                ) : block.type === "figure" ? (
                  <div
                    onClick={() => setActiveIndex(idx)}
                    className={`rounded-[var(--radius-sm)] border p-4 flex flex-col gap-3 transition-colors ${
                      isActive
                        ? "border-[var(--accent-600)]/50 bg-[var(--neutral-50)]/60"
                        : "border-[var(--neutral-200)] bg-white"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--accent-700)]">
                        Verified academic figure
                      </span>
                      <div className="flex items-center gap-2 text-xs">
                        <button
                          type="button"
                          onClick={() => moveBlock(idx, -1)}
                          disabled={idx === 0}
                          className="text-[var(--neutral-600)] hover:text-[var(--neutral-900)] disabled:opacity-40 cursor-pointer"
                        >
                          Move up
                        </button>
                        <button
                          type="button"
                          onClick={() => moveBlock(idx, 1)}
                          disabled={idx === blocks.length - 1}
                          className="text-[var(--neutral-600)] hover:text-[var(--neutral-900)] disabled:opacity-40 cursor-pointer"
                        >
                          Move down
                        </button>
                        <button
                          type="button"
                          onClick={() => removeBlock(idx)}
                          className="text-[var(--error-text)] hover:underline cursor-pointer"
                        >
                          Remove
                        </button>
                      </div>
                    </div>

                    <div className="w-full flex justify-center bg-[var(--neutral-50)] rounded-[var(--radius-sm)] border border-[var(--neutral-200)] p-2.5 sm:p-3 overflow-hidden">
                      <img
                        src={block.figure.url}
                        alt={block.figure.alt}
                        style={{
                          maxWidth: `min(100%, ${computeControlledFigureDimensions(block.figure.width, block.figure.height).widthPx}px)`,
                          maxHeight: "300px",
                        }}
                        className="w-auto h-auto object-contain rounded-[4px]"
                      />
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-[var(--neutral-700)]">
                        Figure caption / description
                      </label>
                      <input
                        type="text"
                        value={block.figure.caption}
                        onChange={(e) =>
                          updateBlock(idx, (b) =>
                            b.type === "figure"
                              ? { ...b, figure: { ...b.figure, caption: e.target.value } }
                              : b
                          )
                        }
                        className="w-full px-3 py-2 text-sm bg-white text-[var(--neutral-900)] border border-[var(--neutral-300)] rounded-[4px]"
                      />
                      {block.figure.attribution ? (
                        <p className="w-full min-w-0 text-[11px] text-[var(--neutral-500)] leading-relaxed m-0 [overflow-wrap:anywhere]">
                          {block.figure.attribution}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ) : block.type === "heading" ? (
                  <div
                    className={`rounded-[var(--radius-sm)] border px-3 py-2 flex items-center gap-2 transition-colors ${
                      isActive
                        ? "border-[var(--accent-600)]/50 bg-[var(--neutral-50)]/50"
                        : "border-transparent hover:border-[var(--neutral-200)]"
                    }`}
                  >
                    <input
                      type="text"
                      aria-label={`Heading level ${block.level}`}
                      value={block.text}
                      onFocus={() => setActiveIndex(idx)}
                      onChange={(e) =>
                        updateBlock(idx, (b) =>
                          b.type === "heading" ? { ...b, text: e.target.value } : b
                        )
                      }
                      className={`min-w-0 flex-1 bg-transparent border-0 focus:outline-none text-[var(--neutral-900)] ${
                        block.level === 1
                          ? "text-xl font-medium"
                          : block.level === 2
                            ? "text-lg font-medium"
                            : "text-base font-semibold"
                      }`}
                    />
                    {block.level > 1 ? (
                      <button
                        type="button"
                        onClick={() => removeBlock(idx)}
                        className="text-xs text-[var(--neutral-400)] hover:text-[var(--error-text)] shrink-0 cursor-pointer"
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                ) : block.type === "bullet_list" ? (
                  <div
                    onClick={() => setActiveIndex(idx)}
                    className={`rounded-[var(--radius-sm)] border p-3 flex flex-col gap-2 transition-colors ${
                      isActive
                        ? "border-[var(--accent-600)]/50 bg-[var(--neutral-50)]/40"
                        : "border-[var(--neutral-200)]"
                    }`}
                  >
                    <ul className="list-disc pl-5 flex flex-col gap-2 m-0">
                      {block.items.map((item, itemIdx) => (
                        <li key={itemIdx} className="text-sm text-[var(--neutral-800)]">
                          <div className="flex items-start gap-2">
                            <InlineEditableBlock
                              value={item}
                              citationClusters={citationClusters}
                              singleKeyLabels={singleKeyLabels}
                              ariaLabel={`Bullet item ${itemIdx + 1}`}
                              onFocusBlock={() => setActiveIndex(idx)}
                              onChangeMarkdown={(nextItem) =>
                                updateBlock(idx, (b) => {
                                  if (b.type !== "bullet_list") return b;
                                  const nextItems = b.items.map((it, i) =>
                                    i === itemIdx ? nextItem : it
                                  );
                                  return { ...b, items: nextItems };
                                })
                              }
                              className="flex-1 text-base leading-relaxed focus:outline-none"
                            />
                            {block.items.length > 1 ? (
                              <button
                                type="button"
                                onClick={() =>
                                  updateBlock(idx, (b) =>
                                    b.type === "bullet_list"
                                      ? {
                                          ...b,
                                          items: b.items.filter((_, i) => i !== itemIdx),
                                        }
                                      : b
                                  )
                                }
                                className="text-xs text-[var(--neutral-400)] hover:text-[var(--error-text)] cursor-pointer"
                              >
                                ×
                              </button>
                            ) : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                    <div className="flex items-center justify-between pt-1">
                      <button
                        type="button"
                        onClick={() =>
                          updateBlock(idx, (b) =>
                            b.type === "bullet_list"
                              ? { ...b, items: [...b.items, "New point"] }
                              : b
                          )
                        }
                        className="text-xs font-medium text-[var(--accent-600)] hover:underline cursor-pointer"
                      >
                        + Add bullet item
                      </button>
                      <button
                        type="button"
                        onClick={() => removeBlock(idx)}
                        className="text-xs text-[var(--neutral-500)] hover:text-[var(--error-text)] cursor-pointer"
                      >
                        Remove list
                      </button>
                    </div>
                  </div>
                ) : block.type === "table" ? (
                  <div
                    onClick={() => setActiveIndex(idx)}
                    className="rounded-[var(--radius-sm)] border border-[var(--neutral-200)] bg-[var(--neutral-50)] p-3 flex flex-col gap-2"
                  >
                    <div className="flex items-center justify-between text-xs text-[var(--neutral-600)]">
                      <span className="font-medium">Data table</span>
                      <button
                        type="button"
                        onClick={() => removeBlock(idx)}
                        className="hover:text-[var(--error-text)] cursor-pointer"
                      >
                        Remove table
                      </button>
                    </div>
                    <textarea
                      aria-label="Data table editor"
                      rows={5}
                      value={block.raw}
                      onFocus={() => setActiveIndex(idx)}
                      onChange={(e) =>
                        updateBlock(idx, (b) =>
                          b.type === "table" ? { ...b, raw: e.target.value } : b
                        )
                      }
                      className="w-full px-2.5 py-2 text-xs font-mono bg-white border border-[var(--neutral-300)] rounded-[4px]"
                    />
                  </div>
                ) : (
                  <div
                    className={`rounded-[var(--radius-sm)] border px-3.5 py-2.5 transition-colors ${
                      isActive
                        ? "border-[var(--accent-600)]/50 bg-[var(--neutral-50)]/40"
                        : "border-[var(--neutral-200)] bg-white hover:border-[var(--neutral-300)]"
                    }`}
                  >
                    <InlineEditableBlock
                      value={block.text}
                      citationClusters={citationClusters}
                      singleKeyLabels={singleKeyLabels}
                      ariaLabel={`Paragraph ${idx + 1}`}
                      onFocusBlock={() => setActiveIndex(idx)}
                      onChangeMarkdown={(nextText) =>
                        updateBlock(idx, (b) =>
                          b.type === "paragraph" || b.type === "blockquote"
                            ? { ...b, text: nextText }
                            : b
                        )
                      }
                      className="text-base text-[var(--neutral-800)] leading-[1.75] focus:outline-none min-h-[1.75rem]"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Verified Open-License Academic Image Search Modal */}
      <ModalCard
        open={figureModalOpen}
        onClose={() => setFigureModalOpen(false)}
        eyebrow="Wikimedia Commons · Open academic licenses"
        title="Insert verified academic image"
        maxWidthClassName="max-w-[640px]"
        footer={
          <Button type="button" variant="ghost" onClick={() => setFigureModalOpen(false)}>
            Close
          </Button>
        }
      >
        <p className="text-sm text-[var(--neutral-600)] leading-relaxed m-0">
          Search for real, openly licensed photographs or scientific diagrams (never AI-generated).
          Collate automatically preserves natural proportions and adds fine-print attribution
          underneath the caption.
        </p>

        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <SearchIcon className="w-4 h-4 text-[var(--neutral-400)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={figureQuery}
              onChange={(e) => setFigureQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleSearchVerifiedImages();
                }
              }}
              placeholder="e.g. Beta vulgaris beetroot, solar microgrid, Wistar rat"
              className="w-full pl-9 pr-3 py-2.5 text-sm bg-white text-[var(--neutral-900)] border border-[var(--neutral-300)] rounded-[var(--radius-sm)]"
            />
          </div>
          <Button
            type="button"
            loading={searchingFigures}
            loadingLabel="Searching..."
            onClick={() => void handleSearchVerifiedImages()}
          >
            Search images
          </Button>
        </div>

        {displayedFigureOptions.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[360px] overflow-y-auto pr-1">
            {displayedFigureOptions.map((fig) => (
              <div
                key={fig.url}
                className="rounded-[var(--radius-sm)] border border-[var(--neutral-200)] bg-[var(--neutral-50)]/60 p-3 flex flex-col justify-between gap-2.5"
              >
                <div className="flex flex-col gap-2">
                  <div className="h-32 bg-white rounded-[4px] border border-[var(--neutral-200)] flex items-center justify-center overflow-hidden p-1.5">
                    <img
                      src={fig.url}
                      alt={fig.alt}
                      className="max-h-full max-w-full w-auto h-auto object-contain"
                    />
                  </div>
                  <p className="text-xs font-medium text-[var(--neutral-900)] line-clamp-2 m-0">
                    {fig.caption}
                  </p>
                  <p className="text-[11px] text-[var(--neutral-500)] m-0">
                    {fig.license} · {fig.naturalWidth}×{fig.naturalHeight}px
                  </p>
                </div>

                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => handleInsertFigureOption(fig)}
                >
                  Insert figure
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-[var(--neutral-500)] text-center py-4 m-0">
            Search above to browse openly licensed Wikimedia Commons photographs and diagrams for
            your chapter.
          </p>
        )}
      </ModalCard>
    </div>
  );
}
