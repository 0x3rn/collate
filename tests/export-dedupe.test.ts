import { describe, expect, it } from "vitest";
import { type ChapterExportRow, planExportDedupe } from "@/lib/export/export-dedupe";

const row = (
  over: Partial<ChapterExportRow> & { id: string; createdAt: number }
): ChapterExportRow => ({
  projectId: "prj_1",
  chapterId: "chp_1",
  format: "docx",
  r2Key: `exports/prj_1/${over.id}.docx`,
  chapterVersion: 2,
  sourceKey: null,
  ...over,
});

describe("planExportDedupe", () => {
  it("keeps the newest export of each chapter version and format and removes older copies", () => {
    const plan = planExportDedupe([
      row({ id: "a", createdAt: 1 }),
      row({ id: "b", createdAt: 3 }),
      row({ id: "c", createdAt: 2 }),
    ]);
    expect(plan.remove.map((r) => r.id).sort()).toEqual(["a", "c"]);
    expect(plan.remove.find((r) => r.id === "a")!.r2Key).toBe("exports/prj_1/a.docx");
    expect(plan.mark).toEqual([{ id: "b", sourceKey: "chp_1:2" }]);
    expect(plan.keptGroups).toBe(1);
  });

  it("keeps different versions, formats, chapters and projects apart", () => {
    const plan = planExportDedupe([
      row({ id: "v1", createdAt: 1, chapterVersion: 1 }),
      row({ id: "v2", createdAt: 2 }),
      row({ id: "pdf", createdAt: 3, format: "pdf", r2Key: "exports/prj_1/pdf.pdf" }),
      row({ id: "ch2", createdAt: 4, chapterId: "chp_2" }),
      row({ id: "other", createdAt: 5, projectId: "prj_2" }),
    ]);
    expect(plan.remove).toEqual([]);
    expect(plan.keptGroups).toBe(5);
    expect(plan.mark).toHaveLength(5);
  });

  it("removes an older copy even if a newer export already has its source key", () => {
    const plan = planExportDedupe([
      row({ id: "old", createdAt: 1 }),
      row({ id: "new", createdAt: 2, sourceKey: "chp_1:2" }),
    ]);
    expect(plan.remove.map((r) => r.id)).toEqual(["old"]);
    expect(plan.mark).toEqual([]);
  });

  it("never deletes a stored file the kept export still uses, and handles no rows", () => {
    const plan = planExportDedupe([
      row({ id: "a", createdAt: 1, r2Key: "exports/shared.docx" }),
      row({ id: "b", createdAt: 2, r2Key: "exports/shared.docx" }),
    ]);
    expect(plan.remove).toEqual([{ id: "a", r2Key: "" }]);
    expect(planExportDedupe([])).toEqual({ remove: [], mark: [], keptGroups: 0 });
  });
});
