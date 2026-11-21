/**
 * Run this script ONCE AFTER 'pnpm exec wrangler login' when you are ready
 * to create real remote Cloudflare resources for dev, staging, and prod.
 *
 * Usage:
 *   node scripts/bootstrap/provision-cloudflare.mjs
 */
import { execFileSync } from "node:child_process";

const IS_WIN = process.platform === "win32";
const ENVS = ["dev", "staging", "prod"];

function run(args) {
  console.log(`> pnpm exec wrangler ${args.join(" ")}`);
  try {
    execFileSync("pnpm", ["exec", "wrangler", ...args], {
      shell: IS_WIN,
      stdio: "inherit",
    });
  } catch {
    console.log("  (resource may already exist — verify output above)");
  }
}

console.log("Checking Cloudflare authentication...");
run(["whoami"]);

for (const env of ENVS) {
  console.log(`
=== Provisioning ${env} ===`);
  run(["d1", "create", `collate-${env}`]);
  run(["r2", "bucket", "create", `collate-files-${env}`]);
  run(["queues", "create", `collate-fetch-${env}`]);
  run(["vectorize", "create", `collate-passages-${env}`, "--dimensions=768", "--metric=cosine"]);
}

console.log("\nNext: copy the printed D1 database_id values into wrangler.jsonc, then run:");
console.log("  pnpm run db:migrate:staging");
