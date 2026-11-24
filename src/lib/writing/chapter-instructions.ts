import { WRITING_CONFIG } from "@/config/writing";
import type { ChapterAttachmentKind } from "@/db/schema";
import { analyzeCsvDataset, type DatasetAnalysisResult } from "./results-data";

export const MAX_CHAPTER_INSTRUCTIONS_CHARS = 24_000;
export const MAX_MARKDOWN_ATTACHMENT_BYTES = 250 * 1024;

export class ChapterInstructionValidationError extends Error {
  public readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "ChapterInstructionValidationError";
    this.status = status;
  }
}

export function inferAttachmentKind(filename: string): ChapterAttachmentKind | null {
  const lower = filename.trim().toLowerCase();
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  if (lower.endsWith(".txt")) return "text";
  return null;
}

function stripControlChars(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code >= 32 && code !== 127) {
      out += raw[i];
    }
  }
  return out;
}

export function sanitizeAttachmentFilename(raw: string): string {
  const leaf = raw.replaceAll("\\", "/").split("/").pop() ?? "";
  const safe = stripControlChars(leaf).trim().slice(0, 120);
  if (!safe) {
    throw new ChapterInstructionValidationError("Uploaded filename cannot be empty.");
  }
  if (!inferAttachmentKind(safe)) {
    throw new ChapterInstructionValidationError(
      "Only .csv, .md, .markdown, and .txt files are supported."
    );
  }
  return safe;
}

/**
 * Heuristic check for raw CSV pasted directly into the instructions text box
 * (at least 2 non-empty lines, consistent comma-separated columns >= 2, not a Markdown pipe table).
 */
export function detectLooksLikeCsv(rawText: string): boolean {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return false;

  const sample = lines.slice(0, Math.min(8, lines.length));
  if (sample.some((l) => l.startsWith("|") || l.startsWith("#") || l.startsWith("- "))) {
    return false;
  }

  const countCommas = (line: string): number => {
    let inQuotes = false;
    let count = 0;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === "," && !inQuotes) {
        count++;
      }
    }
    return count;
  };

  const firstCommaCount = countCommas(sample[0]!);
  if (firstCommaCount < 1 || firstCommaCount > 40) return false;
  // Require every sampled line to share the same column structure and avoid long prose paragraphs
  if (sample[0]!.length > 260) return false;
  return sample.every((line) => countCommas(line) === firstCommaCount);
}

/**
 * Returns true when pre-start chapter inputs contain verified user-provided experimental
 * or empirical measurements (either an analyzed CSV summary table or structured Markdown
 * numeric tables pasted/uploaded by the student).
 */
export function hasUserExperimentalData(params: {
  userInstructions?: string | null;
  userDataSummaryMarkdown?: string | null;
}): boolean {
  if (params.userDataSummaryMarkdown?.trim()) {
    return true;
  }
  const text = params.userInstructions?.trim() ?? "";
  if (!text) return false;

  // Markdown data table containing numeric measurements (at least header + separator + 1 data row)
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const pipeLines = lines.filter((l) => l.startsWith("|") && l.endsWith("|"));
  if (pipeLines.length >= 3 && pipeLines.some((l) => /\d/.test(l))) {
    return true;
  }

  return detectLooksLikeCsv(text);
}

export interface PreparedChapterInstructions {
  userInstructions: string | null;
  userAttachmentName: string | null;
  userAttachmentKind: ChapterAttachmentKind | null;
  userDataSummaryMarkdown: string | null;
  csvAnalysis: DatasetAnalysisResult | null;
  uploadedCsvRaw: string | null;
}

/**
 * Validates and normalizes pre-start chapter instructions, pasted Markdown/CSV content,
 * and optional uploaded .csv / .md / .txt files.
 */
export function prepareChapterInstructionsPayload(input: {
  instructions?: string | null;
  attachmentFilename?: string | null;
  attachmentContent?: string | null;
  keepExistingAttachment?: boolean;
  existingAttachment?: {
    name: string | null;
    kind: ChapterAttachmentKind | null;
    dataSummaryMarkdown: string | null;
  } | null;
}): PreparedChapterInstructions {
  const rawInstructions = (input.instructions ?? "").replace(/\r\n/g, "\n").trim();
  if (rawInstructions.includes("\u0000")) {
    throw new ChapterInstructionValidationError("Instructions contain invalid binary characters.");
  }
  if (rawInstructions.length > MAX_CHAPTER_INSTRUCTIONS_CHARS) {
    throw new ChapterInstructionValidationError(
      `Instructions must be ${MAX_CHAPTER_INSTRUCTIONS_CHARS.toLocaleString("en-US")} characters or fewer.`
    );
  }

  const hasNewAttachment = Boolean(
    input.attachmentFilename?.trim() &&
    input.attachmentContent !== undefined &&
    input.attachmentContent !== null
  );

  // Case 1: New file uploaded (.csv, .md, .markdown, .txt)
  if (hasNewAttachment) {
    const safeName = sanitizeAttachmentFilename(input.attachmentFilename!);
    const kind = inferAttachmentKind(safeName)!;
    const rawFile = input.attachmentContent!.replace(/\r\n/g, "\n");

    if (rawFile.includes("\u0000")) {
      throw new ChapterInstructionValidationError(
        "Uploaded file appears to be binary. Upload plain text CSV or Markdown files only."
      );
    }

    if (kind === "csv") {
      if (rawFile.length > WRITING_CONFIG.limits.maxCsvBytes) {
        throw new ChapterInstructionValidationError("CSV file exceeds the 5 MB size limit.");
      }
      let csvAnalysis: DatasetAnalysisResult;
      try {
        csvAnalysis = analyzeCsvDataset(rawFile);
      } catch (err) {
        throw new ChapterInstructionValidationError(
          err instanceof Error ? err.message : "Could not parse the uploaded CSV file."
        );
      }

      return {
        userInstructions: rawInstructions || null,
        userAttachmentName: safeName,
        userAttachmentKind: "csv",
        userDataSummaryMarkdown: csvAnalysis.markdownTables || null,
        csvAnalysis,
        uploadedCsvRaw: rawFile,
      };
    }

    // Markdown / plain text file upload
    if (rawFile.length > MAX_MARKDOWN_ATTACHMENT_BYTES) {
      throw new ChapterInstructionValidationError(
        "Markdown or text file exceeds the 250 KB upload limit."
      );
    }
    const trimmedFile = rawFile.trim();
    if (!trimmedFile) {
      throw new ChapterInstructionValidationError("Uploaded file is empty.");
    }

    let combinedInstructions = rawInstructions;
    if (!combinedInstructions) {
      combinedInstructions = trimmedFile;
    } else if (!combinedInstructions.includes(trimmedFile)) {
      combinedInstructions = `${combinedInstructions}\n\n${trimmedFile}`;
    }

    if (combinedInstructions.length > MAX_CHAPTER_INSTRUCTIONS_CHARS) {
      throw new ChapterInstructionValidationError(
        `Combined instructions and uploaded file exceed ${MAX_CHAPTER_INSTRUCTIONS_CHARS.toLocaleString("en-US")} characters. Trim the notes or upload a CSV dataset instead.`
      );
    }

    let pastedCsvSummary: string | null = null;
    let pastedCsvAnalysis: DatasetAnalysisResult | null = null;
    if (detectLooksLikeCsv(combinedInstructions)) {
      try {
        pastedCsvAnalysis = analyzeCsvDataset(combinedInstructions);
        pastedCsvSummary = pastedCsvAnalysis.markdownTables || null;
      } catch {
        // Non-fatal: keep as plain user text
      }
    }

    return {
      userInstructions: combinedInstructions,
      userAttachmentName: safeName,
      userAttachmentKind: kind,
      userDataSummaryMarkdown: pastedCsvSummary,
      csvAnalysis: pastedCsvAnalysis,
      uploadedCsvRaw: null,
    };
  }

  // Case 2: No new file uploaded — check whether to preserve an existing attachment
  const keepExisting = Boolean(input.keepExistingAttachment && input.existingAttachment?.name);
  let dataSummary: string | null = keepExisting
    ? (input.existingAttachment?.dataSummaryMarkdown ?? null)
    : null;
  let csvAnalysis: DatasetAnalysisResult | null = null;

  // Auto-analyze pasted CSV content inside the text box if no CSV summary is already attached
  if (!dataSummary && rawInstructions && detectLooksLikeCsv(rawInstructions)) {
    try {
      csvAnalysis = analyzeCsvDataset(rawInstructions);
      dataSummary = csvAnalysis.markdownTables || null;
    } catch {
      // Non-fatal: treat as standard user instructions
    }
  }

  const attachmentName = keepExisting ? (input.existingAttachment?.name ?? null) : null;
  const attachmentKind = keepExisting ? (input.existingAttachment?.kind ?? null) : null;

  // If the user cleared both instructions and attachment, return all nulls
  if (!rawInstructions && !attachmentName && !dataSummary) {
    return {
      userInstructions: null,
      userAttachmentName: null,
      userAttachmentKind: null,
      userDataSummaryMarkdown: null,
      csvAnalysis: null,
      uploadedCsvRaw: null,
    };
  }

  return {
    userInstructions: rawInstructions || null,
    userAttachmentName: attachmentName,
    userAttachmentKind: attachmentKind,
    userDataSummaryMarkdown: dataSummary,
    csvAnalysis,
    uploadedCsvRaw: null,
  };
}
