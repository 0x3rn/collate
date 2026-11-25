/**
 * One-time cleanup of duplicate single-chapter exports made before exports recorded their
 * chapter version (migration 0016). For each chapter, format and version it keeps the newest
 * export, deletes the older copies and their stored files, and records the kept export's
 * source key so later re-exports of that version replace it instead of adding a new one.
 *
 * Full-manuscript and combined exports from before the migration are left alone: which
 * chapter versions went into them was not recorded.
 *
 * Dry run by default (shows what would change, writes nothing):
 *   pnpm exec tsx scripts/dedupe-chapter-exports.ts --local
 *   pnpm exec tsx scripts/dedupe-chapter-exports.ts --remote
 * Apply:
 *   pnpm exec tsx scripts/dedupe-chapter-exports.ts --remote --apply
 *
 * Requires migration 0016 (exports.source_key and exports.chapter_version). Safe to re-run.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type ChapterExportRow, planExportDedupe } from "../src/lib/export/export-dedupe";

const DATABASE = "collate-db";
const BUCKET = "collate-files";
const WRANGLER = resolve("node_modules/wrangler/bin/wrangler.js");
const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const SAFE_SOURCE_KEY = /^[A-Za-z0-9_-]{1,80}:\d{1,6}$/;

function parseArgs(argv: string[]) {
  const remote = argv.includes("--remote");
  const local = argv.includes("--local");
  if (remote === local) throw new Error("Pass exactly one of --local or --remote.");
  return { target: remote ? "--remote" : "--local", apply: argv.includes("--apply") };
}

function wrangler(args: string[]): string {
  return execFileSync(process.execPath, [WRANGLER, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

function query<T>(target: string, sql: string): T[] {
  const out = wrangler(["d1", "execute", DATABASE, target, "--json", "--command", sql]);
  const parsed = JSON.parse(out.slice(out.indexOf("["))) as Array<{ results: T[] }>;
  return parsed[0]?.results ?? [];
}

function main() {
  const { target, apply } = parseArgs(process.argv.slice(2));

  const raw = query<{
    id: string;
    project_id: string;
    chapter_id: string;
    format: string;
    r2_key: string;
    chapter_version: number;
    source_key: string | null;
    created_at: number;
  }>(
    target,
    "SELECT id, project_id, chapter_id, format, r2_key, chapter_version, source_key, created_at " +
      "FROM exports WHERE scope = 'chapter' AND chapter_id IS NOT NULL AND chapter_version IS NOT NULL"
  );
  const rows: ChapterExportRow[] = raw.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    chapterId: r.chapter_id,
    format: r.format,
    r2Key: r.r2_key,
    chapterVersion: r.chapter_version,
    sourceKey: r.source_key,
    createdAt: r.created_at,
  }));

  const plan = planExportDedupe(rows);
  console.log(
    `${rows.length} single-chapter export(s) in ${target.slice(2)} ${DATABASE}: ` +
      `${plan.keptGroups} kept, ${plan.remove.length} duplicate(s) to remove, ` +
      `${plan.mark.length} to mark.`
  );
  for (const r of plan.remove) console.log(`remove ${r.id}${r.r2Key ? `  (${r.r2Key})` : ""}`);
  for (const m of plan.mark) console.log(`keep   ${m.id}  as ${m.sourceKey}`);

  for (const r of plan.remove) {
    if (!SAFE_ID.test(r.id)) throw new Error(`Unexpected export id format: ${r.id}`);
  }
  for (const m of plan.mark) {
    if (!SAFE_ID.test(m.id) || !SAFE_SOURCE_KEY.test(m.sourceKey)) {
      throw new Error(`Unexpected id or source key: ${m.id} ${m.sourceKey}`);
    }
  }

  if (plan.remove.length === 0 && plan.mark.length === 0) {
    console.log("Nothing to change.");
    return;
  }
  if (!apply) {
    console.log("Dry run only. Re-run with --apply to make these changes.");
    return;
  }

  // Delete duplicates before marking, so the kept row never collides with the unique index.
  const statements = [
    ...(plan.remove.length > 0
      ? [`DELETE FROM exports WHERE id IN (${plan.remove.map((r) => `'${r.id}'`).join(", ")});`]
      : []),
    ...plan.mark.map(
      (m) => `UPDATE exports SET source_key = '${m.sourceKey}' WHERE id = '${m.id}';`
    ),
  ];
  const workDir = mkdtempSync(join(tmpdir(), "collate-export-dedupe-"));
  try {
    const sqlPath = join(workDir, "dedupe.sql");
    writeFileSync(sqlPath, `${statements.join("\n")}\n`);
    wrangler(["d1", "execute", DATABASE, target, "--file", sqlPath, "--yes"]);
    console.log(`Database updated: ${plan.remove.length} removed, ${plan.mark.length} marked.`);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }

  // Stored files go last: if one fails to delete it is only an unused file, never a broken row.
  let fileFailures = 0;
  for (const r of plan.remove) {
    if (!r.r2Key) continue;
    try {
      wrangler(["r2", "object", "delete", `${BUCKET}/${r.r2Key}`, target]);
    } catch (err) {
      fileFailures++;
      const reason = err instanceof Error ? err.message.split("\n")[0] : String(err);
      console.warn(`Could not delete stored file ${r.r2Key}: ${reason}`);
    }
  }
  console.log(`Stored files deleted: ${plan.remove.filter((r) => r.r2Key).length - fileFailures}.`);
  if (fileFailures > 0) process.exitCode = 1;
}

main();
