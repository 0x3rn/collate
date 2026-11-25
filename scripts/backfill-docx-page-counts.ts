/**
 * Corrects the page count stored on Word (.docx) exports made before the export engine
 * counted Word pages (older exports saved a flat 2 pages per chapter).
 *
 * For each Word export it downloads the saved file from R2, counts its pages with the same
 * page model the chapter Read & Light edit views use, and updates exports.page_count.
 *
 * Dry run by default (shows what would change, writes nothing):
 *   pnpm exec tsx scripts/backfill-docx-page-counts.ts --local
 *   pnpm exec tsx scripts/backfill-docx-page-counts.ts --remote
 * Write the corrected counts:
 *   pnpm exec tsx scripts/backfill-docx-page-counts.ts --remote --apply
 *
 * Safe to run more than once: rows that already have the right count are left alone.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { estimatePageCountFromDocxBytes } from "../src/lib/export/docx-page-count";

const DATABASE = "collate-db";
const BUCKET = "collate-files";
const WRANGLER = resolve("node_modules/wrangler/bin/wrangler.js");
const EXPORT_ID = /^exp_[0-9a-f-]{36}$/;

interface ExportRow {
  id: string;
  r2_key: string;
  page_count: number;
}

function parseArgs(argv: string[]) {
  const remote = argv.includes("--remote");
  const local = argv.includes("--local");
  if (remote === local) {
    throw new Error("Pass exactly one of --local or --remote.");
  }
  return { target: remote ? "--remote" : "--local", apply: argv.includes("--apply") };
}

function wrangler(args: string[]): string {
  return execFileSync(process.execPath, [WRANGLER, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

function listDocxExports(target: string): ExportRow[] {
  const out = wrangler([
    "d1",
    "execute",
    DATABASE,
    target,
    "--json",
    "--command",
    "SELECT id, r2_key, page_count FROM exports WHERE format = 'docx' ORDER BY created_at",
  ]);
  const parsed = JSON.parse(out.slice(out.indexOf("["))) as Array<{ results: ExportRow[] }>;
  return parsed[0]?.results ?? [];
}

function main() {
  const { target, apply } = parseArgs(process.argv.slice(2));
  const rows = listDocxExports(target);
  console.log(`Found ${rows.length} Word export(s) in ${target.slice(2)} ${DATABASE}.`);

  const workDir = mkdtempSync(join(tmpdir(), "collate-docx-backfill-"));
  const updates: Array<{ id: string; from: number; to: number }> = [];
  let failed = 0;

  try {
    for (const row of rows) {
      if (!EXPORT_ID.test(row.id)) {
        console.warn(`SKIP ${row.id}: unexpected export id format.`);
        failed++;
        continue;
      }
      const filePath = join(workDir, `${row.id}.docx`);
      try {
        wrangler(["r2", "object", "get", `${BUCKET}/${row.r2_key}`, "--file", filePath, target]);
        const pages = estimatePageCountFromDocxBytes(new Uint8Array(readFileSync(filePath)));
        const status = pages === row.page_count ? "ok" : "change";
        console.log(`${status.padEnd(6)} ${row.id}  ${row.page_count} -> ${pages} pages`);
        if (pages !== row.page_count) updates.push({ id: row.id, from: row.page_count, to: pages });
      } catch (err) {
        const reason = err instanceof Error ? err.message.split("\n")[0] : String(err);
        console.warn(`FAIL   ${row.id}  ${reason}`);
        failed++;
      }
    }

    console.log(
      `\n${updates.length} to correct, ${rows.length - updates.length - failed} already right, ${failed} failed.`
    );

    if (updates.length === 0) return;
    if (!apply) {
      console.log("Dry run only. Re-run with --apply to write these counts.");
      return;
    }

    const sql = updates
      .map(
        (u) =>
          `UPDATE exports SET page_count = ${Math.trunc(u.to)} WHERE id = '${u.id}' AND format = 'docx';`
      )
      .join("\n");
    const sqlPath = join(workDir, "backfill.sql");
    writeFileSync(sqlPath, `${sql}\n`);
    wrangler(["d1", "execute", DATABASE, target, "--file", sqlPath, "--yes"]);
    console.log(`Updated ${updates.length} export(s).`);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }

  if (failed > 0) process.exitCode = 1;
}

main();
