"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SearchIcon } from "@/components/layout/workspace-icons";
import { Button } from "@/components/ui/button";
import { CustomSelect } from "@/components/ui/custom-select";
import { ModalCard } from "@/components/ui/modal-card";
import { useToast } from "@/components/ui/toast";
import type { PageSize } from "@/db/schema";
import type { FormattedCitationCluster } from "@/lib/citations/reader-format";
import { computeControlledFigureDimensions } from "@/lib/export/figure-layout";
import { getEditorPageBodyHeightPx, getPageSizeSpec } from "@/lib/export/page-sizes";
import {
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

interface ActiveEditableHandle {
  blockId: string;
  element: HTMLDivElement;
  syncFromDom: () => void;
}

type BlockStyleChoice = "h2" | "h3" | "h4" | "paragraph";

interface FloatingToolbarState {
  top: number;
  left: number;
  bold: boolean;
  italic: boolean;
  blockStyle: BlockStyleChoice | null;
  blockId: string | null;
}

let dynamicBlockCounter = 0;
function createDynamicBlockId(prefix: string): string {
  dynamicBlockCounter += 1;
  return `${prefix}_${Date.now()}_${dynamicBlockCounter}`;
}

function findAncestorTag(
  node: Node | null,
  root: HTMLElement,
  tags: readonly string[]
): HTMLElement | null {
  let current: Node | null = node;
  while (current && current !== root) {
    if (current.nodeType === Node.ELEMENT_NODE) {
      const el = current as HTMLElement;
      if (tags.includes(el.tagName.toUpperCase())) {
        return el;
      }
    }
    current = current.parentNode;
  }
  return null;
}

function unwrapElement(el: HTMLElement): void {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) {
    parent.insertBefore(el.firstChild, el);
  }
  parent.removeChild(el);
}

function selectionContainsProtectedCitation(range: Range): boolean {
  const fragment = range.cloneContents();
  return Boolean(fragment.querySelector?.("[data-cite-token]"));
}

function extractSelectionSplitMarkdown(
  host: HTMLDivElement,
  range: Range
): { before: string; selected: string; after: string } {
  const beforeRange = document.createRange();
  beforeRange.selectNodeContents(host);
  beforeRange.setEnd(range.startContainer, range.startOffset);

  const afterRange = document.createRange();
  afterRange.selectNodeContents(host);
  afterRange.setStart(range.endContainer, range.endOffset);

  const beforeDiv = document.createElement("div");
  beforeDiv.appendChild(beforeRange.cloneContents());

  const selectedDiv = document.createElement("div");
  selectedDiv.appendChild(range.cloneContents());

  const afterDiv = document.createElement("div");
  afterDiv.appendChild(afterRange.cloneContents());

  return {
    before: serializeEditableNodeToMarkdown(beforeDiv),
    selected: serializeEditableNodeToMarkdown(selectedDiv),
    after: serializeEditableNodeToMarkdown(afterDiv),
  };
}

function placeCaretInElement(el: HTMLElement, position: "start" | "end") {
  el.focus({ preventScroll: false });
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(position === "start");
  sel.removeAllRanges();
  sel.addRange(range);
}

function InlineEditableBlock({
  blockId,
  value,
  citationClusters,
  singleKeyLabels,
  className,
  ariaLabel,
  placeholder,
  onRegisterBlock,
  onRegisterActive,
  onFocusBlock,
  onShortcutFormat,
  onEnterSplit,
  onBackspaceAtStart,
  onInsertPageBreakShortcut,
  onChangeMarkdown,
}: {
  blockId: string;
  value: string;
  citationClusters?: Record<string, FormattedCitationCluster>;
  singleKeyLabels?: Record<string, string>;
  className: string;
  ariaLabel: string;
  placeholder?: string;
  onRegisterBlock: (blockId: string, el: HTMLDivElement, sync: () => void) => () => void;
  onRegisterActive: (handle: ActiveEditableHandle) => void;
  onFocusBlock: () => void;
  onShortcutFormat: (command: "bold" | "italic") => void;
  onEnterSplit?: (beforeMd: string, afterMd: string) => void;
  onBackspaceAtStart?: () => void;
  onInsertPageBreakShortcut?: () => void;
  onChangeMarkdown: (next: string) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const lastCommittedRef = useRef<string>(value);
  const onChangeRef = useRef(onChangeMarkdown);
  onChangeRef.current = onChangeMarkdown;

  const syncFromDom = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const nextMd = serializeEditableNodeToMarkdown(el);
    if (nextMd !== lastCommittedRef.current) {
      lastCommittedRef.current = nextMd;
      onChangeRef.current(nextMd);
    }
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return onRegisterBlock(blockId, el, syncFromDom);
  }, [blockId, onRegisterBlock, syncFromDom]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (value !== lastCommittedRef.current || (value !== "" && el.innerHTML === "")) {
      el.innerHTML = inlineMarkdownToEditableHtml(value, citationClusters, singleKeyLabels);
      lastCommittedRef.current = value;
    } else if (value === "" && el.innerHTML !== "") {
      el.innerHTML = "";
      lastCommittedRef.current = "";
    }
  }, [value, citationClusters, singleKeyLabels]);

  function handleFocusOrPointer() {
    onFocusBlock();
    if (ref.current) {
      onRegisterActive({ blockId, element: ref.current, syncFromDom });
    }
  }

  return (
    <div
      ref={ref}
      role="textbox"
      aria-multiline="true"
      aria-label={ariaLabel}
      data-collate-editable="true"
      data-block-id={blockId}
      data-placeholder={placeholder}
      contentEditable
      suppressContentEditableWarning
      onFocus={handleFocusOrPointer}
      onMouseDown={handleFocusOrPointer}
      onMouseUp={handleFocusOrPointer}
      onKeyUp={handleFocusOrPointer}
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && !e.altKey) {
          const key = e.key.toLowerCase();
          if (key === "b" || key === "i") {
            e.preventDefault();
            handleFocusOrPointer();
            onShortcutFormat(key === "b" ? "bold" : "italic");
            return;
          }
          if (e.key === "Enter" && onInsertPageBreakShortcut) {
            e.preventDefault();
            syncFromDom();
            onInsertPageBreakShortcut();
            return;
          }
        }

        if (e.key === "Enter" && !e.shiftKey && onEnterSplit) {
          const el = ref.current;
          const sel = window.getSelection();
          if (el && sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
            e.preventDefault();
            const range = sel.getRangeAt(0);
            const split = extractSelectionSplitMarkdown(el, range);
            onEnterSplit(split.before, split.after);
            return;
          }
        }

        if (e.key === "Backspace" && onBackspaceAtStart) {
          const el = ref.current;
          const sel = window.getSelection();
          if (el && sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
            const range = sel.getRangeAt(0);
            if (range.collapsed) {
              const split = extractSelectionSplitMarkdown(el, range);
              if (split.before === "") {
                e.preventDefault();
                onBackspaceAtStart();
                return;
              }
            }
          }
        }
      }}
      onInput={syncFromDom}
      onBlur={syncFromDom}
      className={className}
    />
  );
}

export function ChapterRichEditor({
  projectId,
  projectTitle,
  markdown,
  wordsPerPage: _wordsPerPage,
  pageSize = "a4",
  marginsMm = 25,
  savingPageSize = false,
  onChangePageSize,
  citationClusters,
  singleKeyLabels,
  initialFigures,
  onChange,
}: {
  projectId: string;
  projectTitle: string;
  markdown: string;
  wordsPerPage: number;
  pageSize?: PageSize;
  marginsMm?: number;
  savingPageSize?: boolean;
  onChangePageSize?: (nextPageSize: PageSize) => void;
  citationClusters?: Record<string, FormattedCitationCluster>;
  singleKeyLabels?: Record<string, string>;
  initialFigures: ProjectFigureOption[];
  onChange: (nextMarkdown: string) => void;
}) {
  void _wordsPerPage;
  const toast = useToast();
  const [rawMode, setRawMode] = useState(false);
  const [blocks, setBlocks] = useState<ChapterDocBlock[]>(() => parseMarkdownToBlocks(markdown));
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [canvasHeightPx, setCanvasHeightPx] = useState<number>(0);
  const [selectionFormats, setSelectionFormats] = useState<{
    hasSelection: boolean;
    bold: boolean;
    italic: boolean;
  }>({ hasSelection: false, bold: false, italic: false });
  const [floatingToolbar, setFloatingToolbar] = useState<FloatingToolbarState | null>(null);

  // Verified academic image picker modal state
  const [figureModalOpen, setFigureModalOpen] = useState(false);
  const [figureQuery, setFigureQuery] = useState(projectTitle.slice(0, 70));
  const [searchingFigures, setSearchingFigures] = useState(false);
  const [projectFigures, setProjectFigures] = useState<ProjectFigureOption[]>(initialFigures);
  const [searchResults, setSearchResults] = useState<ProjectFigureOption[]>([]);

  const editorCanvasRef = useRef<HTMLDivElement | null>(null);
  const activeEditableRef = useRef<ActiveEditableHandle | null>(null);
  const blockSyncMapRef = useRef<Map<HTMLDivElement, () => void>>(new Map());
  const blockElByIdRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const pendingFocusRef = useRef<{ blockId: string; caret: "start" | "end" } | null>(null);
  const blocksRef = useRef<ChapterDocBlock[]>(blocks);
  blocksRef.current = blocks;
  const savedRangeRef = useRef<Range | null>(null);
  const lastSerializedRef = useRef<string>(markdown);
  const toolbarActionHandledRef = useRef<number>(0);

  const registerEditableBlock = useCallback(
    (blockId: string, el: HTMLDivElement, sync: () => void) => {
      blockSyncMapRef.current.set(el, sync);
      blockElByIdRef.current.set(blockId, el);
      return () => {
        blockSyncMapRef.current.delete(el);
        if (blockElByIdRef.current.get(blockId) === el) {
          blockElByIdRef.current.delete(blockId);
        }
      };
    },
    []
  );

  useEffect(() => {
    if (markdown !== lastSerializedRef.current) {
      setBlocks(parseMarkdownToBlocks(markdown));
      lastSerializedRef.current = markdown;
    }
  }, [markdown]);

  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    const el = blockElByIdRef.current.get(pending.blockId);
    if (el) {
      pendingFocusRef.current = null;
      placeCaretInElement(el, pending.caret);
    }
  }, [blocks]);

  useEffect(() => {
    if (rawMode) return;
    const el = editorCanvasRef.current;
    if (!el) return;

    const measure = () => {
      setCanvasHeightPx(el.scrollHeight);
    };
    measure();

    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }
  }, [blocks, pageSize, marginsMm, rawMode]);

  const inspectSelection = useCallback(() => {
    if (typeof window === "undefined" || rawMode) {
      setFloatingToolbar(null);
      return;
    }

    const sel = window.getSelection();
    const canvasEl = editorCanvasRef.current;
    if (!sel || sel.rangeCount === 0 || !canvasEl) {
      setFloatingToolbar(null);
      setSelectionFormats((prev) =>
        prev.hasSelection || prev.bold || prev.italic
          ? { hasSelection: false, bold: false, italic: false }
          : prev
      );
      return;
    }

    const range = sel.getRangeAt(0);
    const commonNode = range.commonAncestorContainer;
    const commonEl =
      commonNode.nodeType === Node.ELEMENT_NODE
        ? (commonNode as HTMLElement)
        : commonNode.parentElement;

    const editableHost = commonEl?.closest?.(
      '[data-collate-editable="true"]'
    ) as HTMLDivElement | null;
    if (!editableHost || !canvasEl.contains(editableHost)) {
      setFloatingToolbar(null);
      return;
    }

    savedRangeRef.current = range.cloneRange();

    const boldActive = Boolean(
      findAncestorTag(range.startContainer, editableHost, ["STRONG", "B"])
    );
    const italicActive = Boolean(findAncestorTag(range.startContainer, editableHost, ["EM", "I"]));
    const nonEmpty = !range.collapsed && range.toString().trim().length > 0;

    setSelectionFormats({ hasSelection: nonEmpty, bold: boldActive, italic: italicActive });

    if (!nonEmpty) {
      setFloatingToolbar(null);
      return;
    }

    const rangeRect = range.getBoundingClientRect();
    const canvasRect = canvasEl.getBoundingClientRect();
    if (rangeRect.width === 0 && rangeRect.height === 0) {
      setFloatingToolbar(null);
      return;
    }

    const blockId = editableHost.getAttribute("data-block-id");
    const hostBlock = blockId ? blocksRef.current.find((b) => b.id === blockId) : undefined;
    let blockStyle: BlockStyleChoice | null = null;
    if (hostBlock?.type === "heading") {
      blockStyle = hostBlock.level === 2 ? "h2" : hostBlock.level === 3 ? "h3" : "h4";
    } else if (hostBlock?.type === "paragraph" || hostBlock?.type === "blockquote") {
      blockStyle = "paragraph";
    }

    const rawLeft = rangeRect.left - canvasRect.left + rangeRect.width / 2;
    const halfMenu = Math.min(212, Math.max(90, canvasRect.width / 2 - 4));
    const clampedLeft = Math.max(halfMenu, Math.min(canvasRect.width - halfMenu, rawLeft));
    const top = Math.max(4, rangeRect.top - canvasRect.top - 48);

    setFloatingToolbar({
      top,
      left: clampedLeft,
      bold: boldActive,
      italic: italicActive,
      blockStyle,
      blockId,
    });
  }, [rawMode]);

  useEffect(() => {
    if (typeof document === "undefined" || rawMode) return;
    document.addEventListener("selectionchange", inspectSelection);
    window.addEventListener("resize", inspectSelection);
    return () => {
      document.removeEventListener("selectionchange", inspectSelection);
      window.removeEventListener("resize", inspectSelection);
    };
  }, [inspectSelection, rawMode]);

  const commitBlocks = useCallback(
    (nextBlocks: ChapterDocBlock[]) => {
      blocksRef.current = nextBlocks;
      setBlocks(nextBlocks);
      const serialized = serializeBlocksToMarkdown(nextBlocks);
      lastSerializedRef.current = serialized;
      onChange(serialized);
    },
    [onChange]
  );

  function updateBlock(index: number, updater: (block: ChapterDocBlock) => ChapterDocBlock) {
    const next = blocksRef.current.map((b, idx) => (idx === index ? updater(b) : b));
    commitBlocks(next);
  }

  function insertBlockAfterActive(newBlock: ChapterDocBlock, explicitAfterIndex?: number) {
    const current = blocksRef.current;
    const anchor = explicitAfterIndex ?? activeIndex;
    const insertAt = Math.min(current.length, Math.max(0, anchor + 1));
    const next = [...current.slice(0, insertAt), newBlock, ...current.slice(insertAt)];
    commitBlocks(next);
    setActiveIndex(insertAt);
  }

  function removeBlock(index: number) {
    const next = blocksRef.current.filter((_, idx) => idx !== index);
    commitBlocks(next);
    setActiveIndex(Math.max(0, index - 1));
  }

  function moveBlock(index: number, delta: -1 | 1) {
    const current = blocksRef.current;
    const target = index + delta;
    if (target < 0 || target >= current.length) return;
    const next = [...current];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved!);
    commitBlocks(next);
    setActiveIndex(target);
  }

  function handleEnterSplitBlock(index: number, beforeMd: string, afterMd: string) {
    const current = blocksRef.current;
    const block = current[index];
    if (
      !block ||
      (block.type !== "paragraph" && block.type !== "heading" && block.type !== "blockquote")
    ) {
      return;
    }

    const newBlankId = createDynamicBlockId("blk_p");

    // Caret at very start of a non-empty block -> push current block down by inserting a blank line ABOVE it (just like Word)
    if (beforeMd === "" && afterMd !== "") {
      const next = [
        ...current.slice(0, index),
        { id: newBlankId, type: "paragraph" as const, text: "" },
        ...current.slice(index),
      ];
      pendingFocusRef.current = { blockId: block.id, caret: "start" };
      commitBlocks(next);
      setActiveIndex(index + 1);
      return;
    }

    // Caret in middle or end (or on an empty blank line) -> keep beforeMd in current block, move afterMd into new block below
    const updatedCurrent: ChapterDocBlock =
      block.type === "heading" ? { ...block, text: beforeMd } : { ...block, text: beforeMd };
    const newBelow: ChapterDocBlock = {
      id: newBlankId,
      type: "paragraph",
      text: afterMd,
    };

    const next = [
      ...current.slice(0, index),
      updatedCurrent,
      newBelow,
      ...current.slice(index + 1),
    ];
    pendingFocusRef.current = { blockId: newBlankId, caret: "start" };
    commitBlocks(next);
    setActiveIndex(index + 1);
  }

  function handleBackspaceAtStart(index: number) {
    const current = blocksRef.current;
    const block = current[index];
    if (!block) return;

    const isBlockEmpty =
      (block.type === "paragraph" || block.type === "blockquote" || block.type === "heading") &&
      block.text.trim() === "";

    // 1. Backspace inside an empty blank line -> delete this blank line and focus previous editable block
    if (isBlockEmpty && current.length > 1) {
      const next = current.filter((_, idx) => idx !== index);
      let focusTarget: { blockId: string; caret: "start" | "end" } | null = null;
      for (let i = index - 1; i >= 0; i--) {
        const candidate = next[i];
        if (
          candidate &&
          (candidate.type === "paragraph" ||
            candidate.type === "heading" ||
            candidate.type === "blockquote")
        ) {
          focusTarget = { blockId: candidate.id, caret: "end" };
          setActiveIndex(i);
          break;
        }
      }
      if (!focusTarget && next[0]) {
        focusTarget = { blockId: next[0].id, caret: "start" };
        setActiveIndex(0);
      }
      pendingFocusRef.current = focusTarget;
      commitBlocks(next);
      return;
    }

    if (index === 0) return;

    const prev = current[index - 1];
    if (!prev) return;

    // 2. Previous block is an empty blank line -> remove it to pull current block (and everything below) back UP
    if (prev.type === "paragraph" && prev.text.trim() === "") {
      const next = [...current.slice(0, index - 1), ...current.slice(index)];
      pendingFocusRef.current = { blockId: block.id, caret: "start" };
      commitBlocks(next);
      setActiveIndex(index - 1);
      return;
    }

    // 3. Previous block is a non-empty paragraph & current is a paragraph -> merge cleanly
    if (prev.type === "paragraph" && block.type === "paragraph") {
      const mergedText = `${prev.text.trim()} ${block.text.trim()}`.trim();
      const next = [
        ...current.slice(0, index - 1),
        { ...prev, text: mergedText },
        ...current.slice(index + 1),
      ];
      pendingFocusRef.current = { blockId: prev.id, caret: "end" };
      commitBlocks(next);
      setActiveIndex(index - 1);
    }
  }

  const applyBlockStyleChoice = useCallback(
    (choice: BlockStyleChoice) => {
      const current = blocksRef.current;
      const targetId = floatingToolbar?.blockId ?? activeEditableRef.current?.blockId;
      const blockIdx = targetId ? current.findIndex((b) => b.id === targetId) : activeIndex;

      if (blockIdx < 0 || blockIdx >= current.length) return;
      const block = current[blockIdx]!;
      if (block.type !== "paragraph" && block.type !== "heading" && block.type !== "blockquote") {
        return;
      }

      const targetLevel = choice === "h2" ? 2 : choice === "h3" ? 3 : choice === "h4" ? 4 : null;
      const host = blockElByIdRef.current.get(block.id);
      const sel = typeof window !== "undefined" ? window.getSelection() : null;
      const range =
        sel && sel.rangeCount > 0 && host?.contains(sel.anchorNode)
          ? sel.getRangeAt(0)
          : savedRangeRef.current && host?.contains(savedRangeRef.current.commonAncestorContainer)
            ? savedRangeRef.current
            : null;

      // If converting a highlighted substring inside a multi-sentence paragraph into a heading, split cleanly
      if (block.type === "paragraph" && targetLevel !== null && host && range && !range.collapsed) {
        const split = extractSelectionSplitMarkdown(host, range);
        const hasSurroundingText = split.before.length > 0 || split.after.length > 0;
        const selectedClean = split.selected.trim();

        if (hasSurroundingText && selectedClean.length > 0) {
          const replacement: ChapterDocBlock[] = [];
          if (split.before.length > 0) {
            replacement.push({
              id: createDynamicBlockId("blk_p"),
              type: "paragraph",
              text: split.before,
            });
          }
          const headingId = createDynamicBlockId(`blk_h${targetLevel}`);
          replacement.push({
            id: headingId,
            type: "heading",
            level: targetLevel,
            text: selectedClean,
          });
          if (split.after.length > 0) {
            replacement.push({
              id: createDynamicBlockId("blk_p"),
              type: "paragraph",
              text: split.after,
            });
          }

          const next = [
            ...current.slice(0, blockIdx),
            ...replacement,
            ...current.slice(blockIdx + 1),
          ];
          const newHeadingIdx = blockIdx + (split.before.length > 0 ? 1 : 0);
          pendingFocusRef.current = { blockId: headingId, caret: "end" };
          setFloatingToolbar(null);
          commitBlocks(next);
          setActiveIndex(newHeadingIdx);
          return;
        }
      }

      // Otherwise convert the entire block in place
      const updatedBlock: ChapterDocBlock =
        targetLevel === null
          ? { id: block.id, type: "paragraph", text: block.text }
          : { id: block.id, type: "heading", level: targetLevel, text: block.text };

      const next = current.map((b, i) => (i === blockIdx ? updatedBlock : b));
      pendingFocusRef.current = { blockId: block.id, caret: "end" };
      setFloatingToolbar(null);
      commitBlocks(next);
      setActiveIndex(blockIdx);
    },
    [activeIndex, commitBlocks, floatingToolbar?.blockId]
  );

  const applyInlineCommand = useCallback(
    (command: "bold" | "italic") => {
      if (typeof window === "undefined" || typeof document === "undefined") return;

      const handle = activeEditableRef.current;
      const sel = window.getSelection();
      if (!sel) return;

      let host: HTMLDivElement | null = handle?.element ?? null;
      let range: Range | null = null;

      if (sel.rangeCount > 0) {
        const liveRange = sel.getRangeAt(0);
        const container =
          liveRange.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
            ? (liveRange.commonAncestorContainer as HTMLElement)
            : liveRange.commonAncestorContainer.parentElement;
        const foundHost = container?.closest?.(
          '[data-collate-editable="true"]'
        ) as HTMLDivElement | null;
        if (foundHost && editorCanvasRef.current?.contains(foundHost)) {
          host = foundHost;
          range = liveRange;
        }
      }

      if (
        !range &&
        savedRangeRef.current &&
        host &&
        host.contains(savedRangeRef.current.commonAncestorContainer)
      ) {
        range = savedRangeRef.current.cloneRange();
        host.focus({ preventScroll: true });
        sel.removeAllRanges();
        sel.addRange(range);
      }

      if (!host || !range || range.collapsed || range.toString().trim().length === 0) {
        toast.info(
          `Highlight the words you want to ${command === "bold" ? "bold" : "italicize"} first.`,
          "Select text first"
        );
        return;
      }

      if (selectionContainsProtectedCitation(range)) {
        toast.info(
          "Select words outside blue citation chips to apply bold or italics.",
          "Citation chip selected"
        );
        return;
      }

      const targetTags = command === "bold" ? (["STRONG", "B"] as const) : (["EM", "I"] as const);
      const wrapTag = command === "bold" ? "strong" : "em";
      const htmlBefore = host.innerHTML;

      host.focus({ preventScroll: true });
      sel.removeAllRanges();
      sel.addRange(range);

      const existingAncestor = findAncestorTag(range.commonAncestorContainer, host, targetTags);

      let didMutate: boolean;
      try {
        document.execCommand("styleWithCSS", false, "false");
        document.execCommand(command, false);
        didMutate = host.innerHTML !== htmlBefore;
      } catch {
        didMutate = false;
      }

      if (!didMutate) {
        if (existingAncestor && existingAncestor.textContent?.trim() === range.toString().trim()) {
          const textRef = existingAncestor.firstChild;
          unwrapElement(existingAncestor);
          if (textRef) {
            const nextRange = document.createRange();
            nextRange.selectNodeContents(textRef);
            sel.removeAllRanges();
            sel.addRange(nextRange);
          }
        } else {
          const wrapper = document.createElement(wrapTag);
          const extracted = range.extractContents();
          wrapper.appendChild(extracted);
          range.insertNode(wrapper);

          const nextRange = document.createRange();
          nextRange.selectNodeContents(wrapper);
          sel.removeAllRanges();
          sel.addRange(nextRange);
        }
      }

      const directSync = blockSyncMapRef.current.get(host);
      if (directSync) {
        directSync();
      } else if (handle && handle.element === host) {
        handle.syncFromDom();
      } else {
        host.dispatchEvent(new Event("input", { bubbles: true }));
      }

      if (sel.rangeCount > 0) {
        savedRangeRef.current = sel.getRangeAt(0).cloneRange();
      }
      requestAnimationFrame(() => inspectSelection());
    },
    [inspectSelection, toast]
  );

  function triggerToolbarAction(action: () => void, fromPointerDown: boolean) {
    const now = Date.now();
    if (!fromPointerDown && now - toolbarActionHandledRef.current < 300) {
      return;
    }
    if (fromPointerDown) {
      toolbarActionHandledRef.current = now;
    }
    action();
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
      id: createDynamicBlockId("blk_fig"),
      type: "figure",
      figure: figureData,
    });
    setFigureModalOpen(false);
    toast.success("Verified figure inserted with proper license attribution.", "Figure added");
  }

  const pageSpec = getPageSizeSpec(pageSize);
  const pageBodyHeightPx = getEditorPageBodyHeightPx(pageSize, marginsMm);
  const pageHeaderOffsetPx = 32;
  const contentSpanPx = Math.max(pageBodyHeightPx, canvasHeightPx - pageHeaderOffsetPx);
  const totalFixedPages = Math.max(1, Math.ceil(contentSpanPx / pageBodyHeightPx));
  const displayedFigureOptions = searchResults.length > 0 ? searchResults : projectFigures;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-[var(--neutral-600)] leading-relaxed m-0">
        Edit directly below. Highlight any text for formatting and heading sizes, or press Enter to
        push items across the fixed page boundary lines. Blue citations stay locked automatically.
      </p>

      {/* Organized 2-row toolbar separated by function: Row 1 (Format + Document size + Source) | Row 2 (Insert) */}
      <div
        role="toolbar"
        aria-label="Chapter formatting toolbar"
        className="sticky top-[64px] lg:top-3 z-20 flex flex-col gap-2 px-3 py-2.5 bg-[var(--neutral-50)] border border-[var(--neutral-200)] rounded-[var(--radius-sm)]"
      >
        {!rawMode ? (
          <>
            {/* Row 1: Format + Document size + Markdown source */}
            <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
              <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--neutral-500)] leading-none">
                    Format
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      title="Bold selected text (Ctrl+B)"
                      aria-pressed={selectionFormats.bold}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        triggerToolbarAction(() => applyInlineCommand("bold"), true);
                      }}
                      onClick={() => triggerToolbarAction(() => applyInlineCommand("bold"), false)}
                      className={`min-w-[32px] h-[34px] px-2.5 text-xs font-bold border rounded-[4px] transition-colors cursor-pointer ${
                        selectionFormats.bold
                          ? "bg-[var(--accent-600)] text-white border-[var(--accent-600)]"
                          : "text-[var(--neutral-800)] bg-white border-[var(--neutral-200)] hover:bg-[var(--neutral-100)]"
                      }`}
                    >
                      B
                    </button>
                    <button
                      type="button"
                      title="Italicize selected text (Ctrl+I)"
                      aria-pressed={selectionFormats.italic}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        triggerToolbarAction(() => applyInlineCommand("italic"), true);
                      }}
                      onClick={() =>
                        triggerToolbarAction(() => applyInlineCommand("italic"), false)
                      }
                      className={`min-w-[32px] h-[34px] px-2.5 text-xs italic font-serif border rounded-[4px] transition-colors cursor-pointer ${
                        selectionFormats.italic
                          ? "bg-[var(--accent-600)] text-white border-[var(--accent-600)]"
                          : "text-[var(--neutral-800)] bg-white border-[var(--neutral-200)] hover:bg-[var(--neutral-100)]"
                      }`}
                    >
                      I
                    </button>
                  </div>
                </div>

                <span aria-hidden="true" className="w-px h-8 bg-[var(--neutral-200)]" />

                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="editor-doc-page-size"
                    className="text-[10px] font-semibold uppercase tracking-wider text-[var(--neutral-500)] leading-none"
                  >
                    Document size
                  </label>
                  <div className="w-[144px]">
                    <CustomSelect<PageSize>
                      id="editor-doc-page-size"
                      ariaLabel="Document page size for whole project"
                      size="sm"
                      disabled={savingPageSize || !onChangePageSize}
                      value={pageSize}
                      onChange={(nextSize) => onChangePageSize?.(nextSize)}
                      buttonClassName="min-h-[34px] h-[34px] py-1 px-2.5 text-xs font-medium border-[var(--neutral-200)]"
                      options={[
                        {
                          value: "a4",
                          label: "A4",
                          description: "210 × 297 mm · Whole document",
                        },
                        {
                          value: "letter",
                          label: "US Letter",
                          description: "8.5 × 11 in · Whole document",
                        },
                      ]}
                    />
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setFloatingToolbar(null);
                  setRawMode(true);
                }}
                className="h-[34px] px-2.5 text-xs font-medium text-[var(--neutral-600)] hover:text-[var(--neutral-900)] hover:bg-[var(--neutral-100)] rounded-[4px] transition-colors cursor-pointer"
              >
                Markdown source
              </button>
            </div>

            {/* Row 2: Insert elements */}
            <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-[var(--neutral-200)]/75">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--neutral-500)] mr-1">
                Insert
              </span>
              <button
                type="button"
                onClick={() =>
                  insertBlockAfterActive({
                    id: createDynamicBlockId("blk_p"),
                    type: "paragraph",
                    text: "Write your paragraph here.",
                  })
                }
                className="h-[30px] px-2.5 text-xs font-medium text-[var(--neutral-700)] bg-white border border-[var(--neutral-200)] rounded-[4px] hover:bg-[var(--neutral-100)] cursor-pointer"
              >
                + Paragraph
              </button>
              <button
                type="button"
                onClick={() =>
                  insertBlockAfterActive({
                    id: createDynamicBlockId("blk_h2"),
                    type: "heading",
                    level: 2,
                    text: "New section heading",
                  })
                }
                className="h-[30px] px-2.5 text-xs font-medium text-[var(--neutral-700)] bg-white border border-[var(--neutral-200)] rounded-[4px] hover:bg-[var(--neutral-100)] cursor-pointer"
              >
                + Heading
              </button>
              <button
                type="button"
                onClick={() =>
                  insertBlockAfterActive({
                    id: createDynamicBlockId("blk_ul"),
                    type: "bullet_list",
                    items: ["List item"],
                  })
                }
                className="h-[30px] px-2.5 text-xs font-medium text-[var(--neutral-700)] bg-white border border-[var(--neutral-200)] rounded-[4px] hover:bg-[var(--neutral-100)] cursor-pointer"
              >
                + List
              </button>
              <button
                type="button"
                onClick={() =>
                  insertBlockAfterActive({
                    id: createDynamicBlockId("blk_pb"),
                    type: "page_break",
                  })
                }
                className="h-[30px] px-2.5 text-xs font-medium text-[var(--accent-700)] bg-white border border-[var(--neutral-200)] rounded-[4px] hover:bg-[var(--accent-100)]/60 cursor-pointer"
              >
                + Page break
              </button>
              <button
                type="button"
                onClick={() => setFigureModalOpen(true)}
                className="h-[30px] px-2.5 text-xs font-medium text-[var(--accent-700)] bg-white border border-[var(--neutral-200)] rounded-[4px] hover:bg-[var(--accent-100)]/60 cursor-pointer"
              >
                + Verified image
              </button>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-[var(--neutral-600)]">
              Markdown source mode
            </span>
            <button
              type="button"
              onClick={() => {
                setFloatingToolbar(null);
                setRawMode(false);
              }}
              className="h-[34px] px-2.5 text-xs font-medium text-[var(--neutral-600)] hover:text-[var(--neutral-900)] hover:bg-[var(--neutral-100)] rounded-[4px] transition-colors cursor-pointer"
            >
              Back to formatted view
            </button>
          </div>
        )}
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
        <div ref={editorCanvasRef} className="relative flex flex-col gap-3 pt-8">
          {/* Constant fixed-position physical page boundary guides (never move when pressing Enter) */}
          <div
            aria-hidden="true"
            data-page-guides="true"
            className="pointer-events-none select-none absolute inset-x-0 top-0 bottom-0 z-10"
          >
            <div
              data-fixed-page-line="1"
              style={{ top: "0px" }}
              className="absolute inset-x-0 flex items-center gap-2"
            >
              <span className="text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-[4px] bg-[var(--neutral-100)] text-[var(--neutral-600)] border border-[var(--neutral-200)] tabular-nums">
                Page 1 · {pageSpec.shortLabel}
              </span>
              <span className="h-px flex-1 bg-[var(--neutral-200)]/70" />
              <span className="text-[10px] font-medium text-[var(--neutral-400)] tabular-nums">
                {pageSpec.dimensionsLabel}
              </span>
            </div>

            {Array.from({ length: Math.max(0, totalFixedPages - 1) }, (_, idx) => {
              const pageNum = idx + 2;
              const topPx = pageHeaderOffsetPx + (pageNum - 1) * pageBodyHeightPx;
              return (
                <div
                  key={pageNum}
                  data-fixed-page-line={String(pageNum)}
                  style={{ top: `${topPx}px` }}
                  className="absolute inset-x-0 -translate-y-1/2 flex items-center gap-2"
                >
                  <span className="flex-1 border-t border-dashed border-[var(--accent-600)]/45" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-[var(--neutral-50)]/95 text-[var(--accent-700)] border border-[var(--accent-600)]/30 shadow-[0_1px_2px_rgba(23,22,20,0.06)] tabular-nums">
                    Page {pageNum} · {pageSpec.shortLabel}
                  </span>
                  <span className="flex-1 border-t border-dashed border-[var(--accent-600)]/45" />
                </div>
              );
            })}
          </div>
          {/* Floating context menu right above highlighted text */}
          {floatingToolbar ? (
            <div
              role="toolbar"
              aria-label="Text selection formatting"
              style={{
                top: `${floatingToolbar.top}px`,
                left: `${floatingToolbar.left}px`,
              }}
              className="absolute -translate-x-1/2 z-30 max-w-[calc(100%-8px)] inline-flex flex-wrap items-center justify-center gap-1 px-1.5 py-1 rounded-[var(--radius-sm)] bg-[var(--neutral-900)] text-white shadow-[0_10px_28px_-6px_rgba(23,22,20,0.38)]"
            >
              <button
                type="button"
                aria-label="Bold selection"
                title="Bold (Ctrl+B)"
                aria-pressed={floatingToolbar.bold}
                onMouseDown={(e) => {
                  e.preventDefault();
                  triggerToolbarAction(() => applyInlineCommand("bold"), true);
                }}
                onClick={() => triggerToolbarAction(() => applyInlineCommand("bold"), false)}
                className={`px-2 py-1 text-xs font-bold rounded-[4px] transition-colors cursor-pointer ${
                  floatingToolbar.bold
                    ? "bg-white text-[var(--neutral-900)]"
                    : "text-white hover:bg-white/15"
                }`}
              >
                Bold
              </button>
              <button
                type="button"
                aria-label="Italicize selection"
                title="Italic (Ctrl+I)"
                aria-pressed={floatingToolbar.italic}
                onMouseDown={(e) => {
                  e.preventDefault();
                  triggerToolbarAction(() => applyInlineCommand("italic"), true);
                }}
                onClick={() => triggerToolbarAction(() => applyInlineCommand("italic"), false)}
                className={`px-2 py-1 text-xs italic font-serif rounded-[4px] transition-colors cursor-pointer ${
                  floatingToolbar.italic
                    ? "bg-white text-[var(--neutral-900)]"
                    : "text-white hover:bg-white/15"
                }`}
              >
                Italic
              </button>

              {floatingToolbar.blockStyle !== null ? (
                <>
                  <span aria-hidden="true" className="w-px h-4 bg-white/20 mx-0.5" />
                  <button
                    type="button"
                    aria-label="Set as Heading"
                    title="Main section heading (largest)"
                    aria-pressed={floatingToolbar.blockStyle === "h2"}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      triggerToolbarAction(() => applyBlockStyleChoice("h2"), true);
                    }}
                    onClick={() => triggerToolbarAction(() => applyBlockStyleChoice("h2"), false)}
                    className={`px-2 py-1 text-[13px] font-bold rounded-[4px] transition-colors cursor-pointer ${
                      floatingToolbar.blockStyle === "h2"
                        ? "bg-white text-[var(--neutral-900)]"
                        : "text-white hover:bg-white/15"
                    }`}
                  >
                    Heading
                  </button>
                  <button
                    type="button"
                    aria-label="Set as Subheading"
                    title="Subheading (medium)"
                    aria-pressed={floatingToolbar.blockStyle === "h3"}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      triggerToolbarAction(() => applyBlockStyleChoice("h3"), true);
                    }}
                    onClick={() => triggerToolbarAction(() => applyBlockStyleChoice("h3"), false)}
                    className={`px-2 py-1 text-[12px] font-semibold rounded-[4px] transition-colors cursor-pointer ${
                      floatingToolbar.blockStyle === "h3"
                        ? "bg-white text-[var(--neutral-900)]"
                        : "text-white hover:bg-white/15"
                    }`}
                  >
                    Subheading
                  </button>
                  <button
                    type="button"
                    aria-label="Set as Sub-section"
                    title="Minor heading (smaller)"
                    aria-pressed={floatingToolbar.blockStyle === "h4"}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      triggerToolbarAction(() => applyBlockStyleChoice("h4"), true);
                    }}
                    onClick={() => triggerToolbarAction(() => applyBlockStyleChoice("h4"), false)}
                    className={`px-2 py-1 text-[11px] font-medium rounded-[4px] transition-colors cursor-pointer ${
                      floatingToolbar.blockStyle === "h4"
                        ? "bg-white text-[var(--neutral-900)]"
                        : "text-white hover:bg-white/15"
                    }`}
                  >
                    Sub-section
                  </button>
                  <button
                    type="button"
                    aria-label="Set as Normal text"
                    title="Normal paragraph text"
                    aria-pressed={floatingToolbar.blockStyle === "paragraph"}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      triggerToolbarAction(() => applyBlockStyleChoice("paragraph"), true);
                    }}
                    onClick={() =>
                      triggerToolbarAction(() => applyBlockStyleChoice("paragraph"), false)
                    }
                    className={`px-2 py-1 text-[11px] font-normal rounded-[4px] transition-colors cursor-pointer ${
                      floatingToolbar.blockStyle === "paragraph"
                        ? "bg-white text-[var(--neutral-900)]"
                        : "text-white/85 hover:bg-white/15 hover:text-white"
                    }`}
                  >
                    Normal
                  </button>
                </>
              ) : null}
            </div>
          ) : null}

          {blocks.map((block, idx) => {
            const isActive = idx === activeIndex;

            return (
              <div key={block.id} className="flex flex-col gap-2">
                {block.type === "page_break" ? (
                  <div
                    onClick={() => setActiveIndex(idx)}
                    className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-[var(--radius-sm)] border border-dashed border-[var(--accent-600)]/50 bg-[var(--accent-100)]/30 text-xs text-[var(--accent-700)]"
                  >
                    <span className="font-medium">
                      Page break: content below starts on a new page in PDF &amp; Word
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeBlock(idx);
                      }}
                      className="text-xs font-medium text-[var(--neutral-600)] hover:text-[var(--error-text)] cursor-pointer shrink-0"
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
                      <div className="flex items-center gap-2.5 text-xs">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            moveBlock(idx, -1);
                          }}
                          disabled={idx === 0}
                          className="text-[var(--neutral-600)] hover:text-[var(--neutral-900)] disabled:opacity-40 cursor-pointer"
                        >
                          Move up
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            moveBlock(idx, 1);
                          }}
                          disabled={idx === blocks.length - 1}
                          className="text-[var(--neutral-600)] hover:text-[var(--neutral-900)] disabled:opacity-40 cursor-pointer"
                        >
                          Move down
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeBlock(idx);
                          }}
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
                    <InlineEditableBlock
                      blockId={block.id}
                      value={block.text}
                      citationClusters={citationClusters}
                      singleKeyLabels={singleKeyLabels}
                      ariaLabel={`Heading level ${block.level}`}
                      onRegisterBlock={registerEditableBlock}
                      onRegisterActive={(handle) => {
                        activeEditableRef.current = handle;
                      }}
                      onFocusBlock={() => setActiveIndex(idx)}
                      onShortcutFormat={applyInlineCommand}
                      onEnterSplit={(before, after) => handleEnterSplitBlock(idx, before, after)}
                      onBackspaceAtStart={() => handleBackspaceAtStart(idx)}
                      onInsertPageBreakShortcut={() =>
                        insertBlockAfterActive(
                          { id: createDynamicBlockId("blk_pb"), type: "page_break" },
                          idx
                        )
                      }
                      onChangeMarkdown={(nextText) =>
                        updateBlock(idx, (b) =>
                          b.type === "heading" ? { ...b, text: nextText } : b
                        )
                      }
                      className={`min-w-0 flex-1 bg-transparent border-0 focus:outline-none text-[var(--neutral-900)] leading-snug ${
                        block.level === 1
                          ? "text-xl font-medium"
                          : block.level === 2
                            ? "text-lg font-medium"
                            : block.level === 3
                              ? "text-base font-semibold"
                              : "text-[0.9375rem] font-semibold text-[var(--neutral-800)]"
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
                              blockId={`${block.id}_li_${itemIdx}`}
                              value={item}
                              citationClusters={citationClusters}
                              singleKeyLabels={singleKeyLabels}
                              ariaLabel={`Bullet item ${itemIdx + 1}`}
                              onRegisterBlock={registerEditableBlock}
                              onRegisterActive={(handle) => {
                                activeEditableRef.current = handle;
                              }}
                              onFocusBlock={() => setActiveIndex(idx)}
                              onShortcutFormat={applyInlineCommand}
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
                ) : block.type === "paragraph" && block.text === "" ? (
                  <div
                    className={`rounded-[var(--radius-sm)] border px-3.5 py-1 transition-colors ${
                      isActive
                        ? "border-dashed border-[var(--accent-600)]/50 bg-[var(--neutral-50)]/50"
                        : "border-transparent hover:border-dashed hover:border-[var(--neutral-200)]"
                    }`}
                  >
                    <InlineEditableBlock
                      blockId={block.id}
                      value=""
                      citationClusters={citationClusters}
                      singleKeyLabels={singleKeyLabels}
                      ariaLabel={`Blank line ${idx + 1}`}
                      onRegisterBlock={registerEditableBlock}
                      onRegisterActive={(handle) => {
                        activeEditableRef.current = handle;
                      }}
                      onFocusBlock={() => setActiveIndex(idx)}
                      onShortcutFormat={applyInlineCommand}
                      onEnterSplit={(before, after) => handleEnterSplitBlock(idx, before, after)}
                      onBackspaceAtStart={() => handleBackspaceAtStart(idx)}
                      onInsertPageBreakShortcut={() =>
                        insertBlockAfterActive(
                          { id: createDynamicBlockId("blk_pb"), type: "page_break" },
                          idx
                        )
                      }
                      onChangeMarkdown={(nextText) =>
                        updateBlock(idx, (b) =>
                          b.type === "paragraph" ? { ...b, text: nextText } : b
                        )
                      }
                      className="text-base leading-[1.6] text-[var(--neutral-800)] focus:outline-none min-h-[1.6rem]"
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
                      blockId={block.id}
                      value={block.text}
                      citationClusters={citationClusters}
                      singleKeyLabels={singleKeyLabels}
                      ariaLabel={`Paragraph ${idx + 1}`}
                      onRegisterBlock={registerEditableBlock}
                      onRegisterActive={(handle) => {
                        activeEditableRef.current = handle;
                      }}
                      onFocusBlock={() => setActiveIndex(idx)}
                      onShortcutFormat={applyInlineCommand}
                      onEnterSplit={(before, after) => handleEnterSplitBlock(idx, before, after)}
                      onBackspaceAtStart={() => handleBackspaceAtStart(idx)}
                      onInsertPageBreakShortcut={() =>
                        insertBlockAfterActive(
                          { id: createDynamicBlockId("blk_pb"), type: "page_break" },
                          idx
                        )
                      }
                      onChangeMarkdown={(nextText) =>
                        updateBlock(idx, (b) =>
                          b.type === "paragraph" || b.type === "blockquote"
                            ? { ...b, text: nextText }
                            : b
                        )
                      }
                      className={`text-base leading-[1.75] focus:outline-none min-h-[1.75rem] ${
                        block.type === "blockquote"
                          ? "italic text-[var(--neutral-700)] pl-3 border-l border-[var(--neutral-300)]"
                          : "text-[var(--neutral-800)]"
                      }`}
                    />
                    {isActive ? (
                      <div className="flex flex-wrap items-center justify-center gap-4 pt-2 mt-1.5 border-t border-[var(--neutral-100)] text-xs text-[var(--neutral-500)]">
                        <button
                          type="button"
                          onClick={() =>
                            insertBlockAfterActive(
                              { id: createDynamicBlockId("blk_pb"), type: "page_break" },
                              idx
                            )
                          }
                          className="hover:text-[var(--accent-700)] cursor-pointer"
                        >
                          Insert page break below
                        </button>
                        {blocks.length > 1 ? (
                          <button
                            type="button"
                            onClick={() => removeBlock(idx)}
                            className="hover:text-[var(--error-text)] cursor-pointer"
                          >
                            Delete paragraph
                          </button>
                        ) : null}
                      </div>
                    ) : null}
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
          Search for real, openly licensed photographs or scientific diagrams (never synthetic or
          generated illustrations). Collate automatically preserves natural proportions and adds
          fine-print attribution underneath the caption.
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
