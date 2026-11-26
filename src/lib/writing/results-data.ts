import { WRITING_CONFIG } from "@/config/writing";
import { hasUserExperimentalData } from "./chapter-instructions";

export interface NumericColumnSummary {
  column: string;
  kind: "numeric";
  count: number;
  missing: number;
  mean: number;
  median: number;
  min: number;
  max: number;
  stdDev: number;
}

export interface CategoricalColumnSummary {
  column: string;
  kind: "categorical";
  count: number;
  missing: number;
  distinctCount: number;
  topCategories: Array<{ value: string; count: number; percent: number }>;
}

export type ColumnSummary = NumericColumnSummary | CategoricalColumnSummary;

export interface DatasetAnalysisResult {
  rowCount: number;
  columnCount: number;
  columns: ColumnSummary[];
  markdownTables: string;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

function escapeCell(raw: string): string {
  const cleaned = raw.replaceAll("|", "\\|").replace(/\r?\n/g, " ").trim();
  if (/^[=+@-]/.test(cleaned) && !/^-[0-9]/.test(cleaned)) {
    return `'${cleaned}`;
  }
  return cleaned;
}

function computeMedian(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

export function analyzeCsvDataset(rawCsv: string): DatasetAnalysisResult {
  if (rawCsv.length > WRITING_CONFIG.limits.maxCsvBytes) {
    throw new Error("CSV file exceeds the 5 MB size limit.");
  }

  const lines = rawCsv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error("CSV dataset must contain a header row and at least one data row.");
  }

  const headers = parseCsvLine(lines[0]!).map((h, i) => escapeCell(h) || `column_${i + 1}`);
  const dataLines = lines.slice(1, WRITING_CONFIG.limits.maxCsvRows + 1);
  const rows = dataLines.map(parseCsvLine);

  const columns: ColumnSummary[] = headers.map((colName, colIdx) => {
    const rawValues = rows.map((r) => (r[colIdx] ?? "").trim());
    const nonEmpty = rawValues.filter((v) => v.length > 0);
    const missing = rawValues.length - nonEmpty.length;

    const numericValues = nonEmpty
      .map((v) => Number(v.replaceAll(",", "")))
      .filter((n) => Number.isFinite(n));

    if (nonEmpty.length > 0 && numericValues.length === nonEmpty.length) {
      const sorted = [...numericValues].sort((a, b) => a - b);
      const sum = numericValues.reduce((acc, n) => acc + n, 0);
      const mean = sum / numericValues.length;
      const variance =
        numericValues.length > 1
          ? numericValues.reduce((acc, n) => acc + (n - mean) ** 2, 0) / (numericValues.length - 1)
          : 0;

      return {
        column: colName,
        kind: "numeric",
        count: numericValues.length,
        missing,
        mean: Number(mean.toFixed(2)),
        median: Number(computeMedian(sorted).toFixed(2)),
        min: Number(sorted[0]!.toFixed(2)),
        max: Number(sorted[sorted.length - 1]!.toFixed(2)),
        stdDev: Number(Math.sqrt(variance).toFixed(2)),
      };
    }

    const freq = new Map<string, number>();
    for (const val of nonEmpty) {
      const safeVal = escapeCell(val);
      freq.set(safeVal, (freq.get(safeVal) ?? 0) + 1);
    }

    const topCategories = Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([value, count]) => ({
        value,
        count,
        percent: nonEmpty.length > 0 ? Number(((count / nonEmpty.length) * 100).toFixed(1)) : 0,
      }));

    return {
      column: colName,
      kind: "categorical",
      count: nonEmpty.length,
      missing,
      distinctCount: freq.size,
      topCategories,
    };
  });

  const tableBlocks: string[] = [];
  const numericCols = columns.filter((c): c is NumericColumnSummary => c.kind === "numeric");

  if (numericCols.length > 0) {
    const headerRow = "| Variable | N | Mean | Median | SD | Min | Max |";
    const sepRow = "| --- | ---: | ---: | ---: | ---: | ---: | ---: |";
    const bodyRows = numericCols.map(
      (c) =>
        `| ${c.column} | ${c.count} | ${c.mean} | ${c.median} | ${c.stdDev} | ${c.min} | ${c.max} |`
    );
    tableBlocks.push(
      [
        "**Table: Descriptive Statistics (User-Supplied Dataset)**",
        "",
        headerRow,
        sepRow,
        ...bodyRows,
      ].join("\n")
    );
  }

  const catCols = columns.filter((c): c is CategoricalColumnSummary => c.kind === "categorical");
  for (const cat of catCols.slice(0, 3)) {
    const headerRow = `| ${cat.column} | Frequency (n) | Share (%) |`;
    const sepRow = "| --- | ---: | ---: |";
    const bodyRows = cat.topCategories.map(
      (item) => `| ${item.value} | ${item.count} | ${item.percent}% |`
    );
    tableBlocks.push(
      [
        `**Table: Distribution of ${cat.column} (N = ${cat.count})**`,
        "",
        headerRow,
        sepRow,
        ...bodyRows,
      ].join("\n")
    );
  }

  return {
    rowCount: rows.length,
    columnCount: headers.length,
    columns,
    markdownTables: tableBlocks.join("\n\n"),
  };
}

export function buildLabelledResultsFramework(params: {
  chapterTitle: string;
  topic: string;
  sectionHeadings: string[];
}): string {
  const sectionsMarkdown = params.sectionHeadings.map((heading, idx) => {
    return [
      `## ${idx + 1}. ${heading}`,
      "",
      "**[RESULTS FRAMEWORK PLACEHOLDER — REAL DATA REQUIRED (RULE NN-4)]**",
      `Insert your verified empirical data, instrument responses, or experimental outputs for "${heading}" regarding "${params.topic}".`,
      "",
      "| Metric / Research Question | Observed Value | Sample Size (N) | Statistical Note |",
      "| --- | --- | --- | --- |",
      "| [ADD: Variable 1] | [ADD: Verified value] | [ADD: N] | [ADD: Test / p-value] |",
      "| [ADD: Variable 2] | [ADD: Verified value] | [ADD: N] | [ADD: Test / p-value] |",
    ].join("\n");
  });

  return [
    `# ${params.chapterTitle}`,
    "",
    "> **Integrity Notice (Rule NN-4):** No user dataset or empirical public dataset was attached for this chapter. Collate does not fabricate survey counts, interview quotes, or experiment results. Upload a CSV dataset to generate real statistical tables automatically, or replace the labelled placeholders below with your verified findings.",
    "",
    ...sectionsMarkdown,
  ].join("\n\n");
}

export interface AuthoritativeResultsData {
  source: "csv_dataset" | "chapter_notes" | "none";
  datasetMarkdown: string | null;
  activeFilename: string | null;
  hasInlineNotesOverlap: boolean;
}

/**
 * Resolves a single authoritative empirical dataset for a Results chapter so the writer
 * never receives conflicting duplicate datasets when a user uploads via both the project
 * Results data card and the chapter's Add instructions dialog.
 *
 * Precedence:
 * 1. Latest uploaded CSV dataset (comparing timestamps when both records exist).
 * 2. Author measurements/tables written in chapter pre-start instructions (when no CSV exists).
 * 3. None (orchestrator falls back to published benchmarks, public datasets, or labelled framework).
 */
export function resolveAuthoritativeResultsData(input: {
  chapterDataSummaryMarkdown?: string | null;
  chapterAttachmentName?: string | null;
  chapterUpdatedAt?: Date | null;
  chapterInstructions?: string | null;
  latestDataset?: {
    filename: string;
    summaryJson: string;
    createdAt: Date;
  } | null;
}): AuthoritativeResultsData {
  const chapterMarkdown = input.chapterDataSummaryMarkdown?.trim() || null;

  let projectMarkdown: string | null = null;
  if (input.latestDataset?.summaryJson) {
    try {
      const parsed = JSON.parse(input.latestDataset.summaryJson) as DatasetAnalysisResult;
      projectMarkdown = parsed.markdownTables?.trim() || null;
    } catch {
      projectMarkdown = null;
    }
  }

  const hasInlineNotes = hasUserExperimentalData({
    userInstructions: input.chapterInstructions ?? null,
    userDataSummaryMarkdown: null,
  });

  if (chapterMarkdown && projectMarkdown) {
    const projectIsNewer =
      Boolean(input.latestDataset?.createdAt) &&
      (!input.chapterUpdatedAt ||
        input.latestDataset!.createdAt.getTime() > input.chapterUpdatedAt.getTime());

    if (projectIsNewer) {
      return {
        source: "csv_dataset",
        datasetMarkdown: projectMarkdown,
        activeFilename: input.latestDataset?.filename ?? null,
        hasInlineNotesOverlap: hasInlineNotes,
      };
    }

    return {
      source: "csv_dataset",
      datasetMarkdown: chapterMarkdown,
      activeFilename: input.chapterAttachmentName ?? input.latestDataset?.filename ?? null,
      hasInlineNotesOverlap: hasInlineNotes,
    };
  }

  if (projectMarkdown) {
    return {
      source: "csv_dataset",
      datasetMarkdown: projectMarkdown,
      activeFilename: input.latestDataset?.filename ?? null,
      hasInlineNotesOverlap: hasInlineNotes,
    };
  }

  if (chapterMarkdown) {
    return {
      source: "csv_dataset",
      datasetMarkdown: chapterMarkdown,
      activeFilename: input.chapterAttachmentName ?? null,
      hasInlineNotesOverlap: hasInlineNotes,
    };
  }

  if (hasInlineNotes) {
    return {
      source: "chapter_notes",
      datasetMarkdown: null,
      activeFilename: null,
      hasInlineNotesOverlap: false,
    };
  }

  return {
    source: "none",
    datasetMarkdown: null,
    activeFilename: null,
    hasInlineNotesOverlap: false,
  };
}
