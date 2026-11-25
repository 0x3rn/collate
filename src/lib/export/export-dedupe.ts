/**
 * One-time cleanup plan for single-chapter exports made before exports recorded their
 * chapter version: repeated exports of the same chapter version in the same format are
 * duplicates. The newest one is kept and marked with its source key so later re-exports
 * replace it; the older copies (and their stored files) are removed.
 */

export interface ChapterExportRow {
  id: string;
  projectId: string;
  chapterId: string;
  format: string;
  r2Key: string;
  chapterVersion: number;
  sourceKey: string | null;
  createdAt: number;
}

export interface ExportDedupePlan {
  /** Older duplicate rows to delete, with the stored file each one points to. */
  remove: Array<{ id: string; r2Key: string }>;
  /** Kept rows that still need their source key recorded. */
  mark: Array<{ id: string; sourceKey: string }>;
  keptGroups: number;
}

export function chapterSourceKey(chapterId: string, version: number): string {
  return `${chapterId}:${version}`;
}

export function planExportDedupe(rows: ChapterExportRow[]): ExportDedupePlan {
  const groups = new Map<string, ChapterExportRow[]>();
  for (const row of rows) {
    const key = [row.projectId, row.chapterId, row.format, row.chapterVersion].join("\u0000");
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  const plan: ExportDedupePlan = { remove: [], mark: [], keptGroups: groups.size };
  for (const group of groups.values()) {
    const [keep, ...older] = [...group].sort(
      (a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id)
    );
    if (!keep) continue;
    const sourceKey = chapterSourceKey(keep.chapterId, keep.chapterVersion);
    for (const row of older) {
      // Never delete a file the kept export still uses.
      if (row.r2Key !== keep.r2Key) plan.remove.push({ id: row.id, r2Key: row.r2Key });
      else plan.remove.push({ id: row.id, r2Key: "" });
    }
    if (keep.sourceKey !== sourceKey) plan.mark.push({ id: keep.id, sourceKey });
  }
  return plan;
}
