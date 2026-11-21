import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const IS_WIN = process.platform === "win32";
const FORCE = process.argv.includes("--force");

function logStep(title) {
  console.log(`\n========================================`);
  console.log(`▶ ${title}`);
  console.log(`========================================`);
}

function fail(message) {
  console.error(`\n✖ ERROR: ${message}`);
  process.exit(1);
}

function quoteWinArg(arg) {
  if (!/[\s"&|<>^()]/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '\\"')}"`;
}

function run(cmd, args = [], options = {}) {
  const { capture = false, allowFail = false, cwd = ROOT } = options;
  const finalArgs = IS_WIN ? args.map(quoteWinArg) : args;
  try {
    const out = execFileSync(cmd, finalArgs, {
      cwd,
      shell: IS_WIN,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
      encoding: "utf8",
    });
    return { ok: true, stdout: (out ?? "").trim() };
  } catch (err) {
    if (allowFail) {
      return {
        ok: false,
        stdout: String(err.stdout ?? "").trim(),
        stderr: String(err.stderr ?? "").trim(),
      };
    }
    fail(`Command failed: ${cmd} ${args.join(" ")}\n${err.message}`);
  }
}

function stripJsonComments(input) {
  let out = "";
  let inString = false;
  let escape = false;
  let i = 0;

  while (i < input.length) {
    const ch = input[i];
    const next = input[i + 1];

    if (inString) {
      out += ch;
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      i++;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      i++;
      continue;
    }

    if (ch === "/" && next === "/") {
      i += 2;
      while (i < input.length && input[i] !== "\n") i++;
      continue;
    }

    if (ch === "/" && next === "*") {
      i += 2;
      while (i < input.length && !(input[i] === "*" && input[i + 1] === "/")) i++;
      i += 2;
      continue;
    }

    out += ch;
    i++;
  }

  return out.replace(/,\s*([}\]])/g, "$1");
}

function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(stripJsonComments(raw));
}

function writeFileEnsureDir(relPath, content) {
  const fullPath = path.join(ROOT, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf8");
  console.log(`  ✓ wrote ${relPath}`);
}

function copyDirRecursive(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function checkPrerequisites() {
  logStep("1. Checking local prerequisites");

  const nodeVersion = process.versions.node;
  const major = Number(nodeVersion.split(".")[0]);
  if (!Number.isFinite(major) || major < 20) {
    fail(`Node.js v20+ is required. Found v${nodeVersion}. Install LTS from https://nodejs.org`);
  }
  console.log(`  ✓ Node.js v${nodeVersion}`);

  const gitCheck = run("git", ["--version"], { capture: true, allowFail: true });
  if (!gitCheck.ok) {
    fail("Git is not installed or not in PATH.");
  }
  console.log(`  ✓ ${gitCheck.stdout}`);

  let pnpmCheck = run("pnpm", ["--version"], { capture: true, allowFail: true });
  if (!pnpmCheck.ok) {
    console.log("  … pnpm not found. Attempting to enable via corepack...");
    const cpEnable = run("corepack", ["enable"], { allowFail: true });
    if (cpEnable.ok) {
      run("corepack", ["prepare", "pnpm@latest", "--activate"], { allowFail: true });
      pnpmCheck = run("pnpm", ["--version"], { capture: true, allowFail: true });
    }
  }
  if (!pnpmCheck.ok) {
    console.log("  … Falling back to npm install -g pnpm...");
    run("npm", ["install", "-g", "pnpm"]);
    pnpmCheck = run("pnpm", ["--version"], { capture: true, allowFail: true });
  }
  if (!pnpmCheck.ok) {
    fail("Could not install pnpm automatically. Run 'npm install -g pnpm' and re-run this script.");
  }
  console.log(`  ✓ pnpm v${pnpmCheck.stdout}`);
}

function scaffoldVinextApp() {
  logStep("2. Scaffolding Next.js on Cloudflare Workers (vinext + wrangler.jsonc)");

  const pkgPath = path.join(ROOT, "package.json");
  if (fs.existsSync(pkgPath) && !FORCE) {
    console.log("  ℹ package.json already exists — skipping scaffold (pass --force to re-scaffold).");
    return;
  }

  const tmpBase = path.join(ROOT, ".tmp-scaffold");
  const tmpApp = path.join(tmpBase, "collate");
  fs.rmSync(tmpBase, { recursive: true, force: true });
  fs.mkdirSync(tmpBase, { recursive: true });

  run("pnpm", [
    "dlx",
    "create-vinext-app@latest",
    ".tmp-scaffold/collate",
    "--yes",
    "--skip-install",
    "--disable-git",
    "--platform=cloudflare",
    "--legacy-wrangler-cloudflare-init",
  ]);

  if (!fs.existsSync(path.join(tmpApp, "package.json"))) {
    fail("create-vinext-app did not generate package.json as expected.");
  }

  copyDirRecursive(tmpApp, ROOT);
  fs.rmSync(tmpBase, { recursive: true, force: true });
  console.log("  ✓ Scaffolded vinext Cloudflare Workers project into Collate/");
}

function configurePackageAndPnpm() {
  logStep("3. Configuring package.json & pnpm-workspace.yaml (pnpm v12 allowBuilds)");

  const pkgPath = path.join(ROOT, "package.json");
  const pkg = readJsonFile(pkgPath);

  pkg.name = "collate";
  pkg.private = true;
  pkg.type = "module";

  // Remove legacy package.json#pnpm key (ignored by pnpm v12)
  delete pkg.pnpm;

  // Keep TypeScript on 6.x until typescript-eslint supports TS 7.x
  pkg.devDependencies = {
    ...(pkg.devDependencies ?? {}),
    typescript: "^6.0.0",
  };

  pkg.scripts = {
    ...pkg.scripts,
    typecheck: "tsc --noEmit",
    lint: "eslint .",
    format: "prettier --write .",
    "format:check": "prettier --check .",
    test: "vitest run",
    "test:watch": "vitest",
    "cf-typegen": "wrangler types",
    verify:
      "pnpm run typecheck && pnpm run lint && pnpm run format:check && pnpm run test && pnpm run build",
  };

  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  console.log("  ✓ Updated package.json");

  writeFileEnsureDir(
    "pnpm-workspace.yaml",
    [
      "# pnpm v12 workspace & build-script policy",
      "allowBuilds:",
      "  esbuild: true",
      "  workerd: true",
      "",
    ].join("\n")
  );
}

function installDependencies() {
  logStep("4. Installing dependencies with pnpm");

  run("pnpm", ["install"]);
  run("pnpm", ["add", "zod"]);
  run("pnpm", [
    "add",
    "-D",
    "eslint",
    "@eslint/js",
    "typescript-eslint",
    "eslint-config-prettier",
    "prettier",
    "vitest",
  ]);
}

function configureWrangler() {
  logStep("5. Configuring wrangler.jsonc (dev / staging / prod environments)");

  const wranglerPath = path.join(ROOT, "wrangler.jsonc");
  let existing = {};
  if (fs.existsSync(wranglerPath)) {
    existing = readJsonFile(wranglerPath);
  }

  const today = new Date().toISOString().slice(0, 10);
  const baseConfig = {
    $schema: existing.$schema ?? "node_modules/wrangler/config-schema.json",
    name: "collate-dev",
    main: existing.main ?? "vinext/server/app-router-entry",
    compatibility_date: existing.compatibility_date ?? today,
    compatibility_flags: Array.from(
      new Set([...(existing.compatibility_flags ?? []), "nodejs_compat"])
    ),
    ...(existing.assets ? { assets: existing.assets } : {}),
    ...(existing.images ? { images: existing.images } : {}),
    observability: {
      enabled: true,
    },
    vars: {
      APP_NAME: "Collate",
      APP_ENV: "dev",
    },
    env: {
      staging: {
        name: "collate-staging",
        observability: { enabled: true },
        vars: {
          APP_NAME: "Collate",
          APP_ENV: "staging",
        },
      },
      prod: {
        name: "collate-prod",
        observability: { enabled: true },
        vars: {
          APP_NAME: "Collate",
          APP_ENV: "prod",
        },
      },
    },
  };

  const header = [
    "// Collate — Cloudflare Workers configuration",
    "// Environments: default (dev), staging (--env staging), prod (--env prod)",
    "// Step 0.2 will wire real D1, R2, Queues, Vectorize, Workflows, and Browser Run bindings.",
    "",
  ].join("\n");

  fs.writeFileSync(wranglerPath, `${header}${JSON.stringify(baseConfig, null, 2)}\n`, "utf8");
  console.log("  ✓ Configured wrangler.jsonc");
}

function configureToolingAndRepoFiles() {
  logStep("6. Writing ESLint, Prettier, Vitest, tsconfig, .gitignore, and PROGRESS.md");

  const tsconfigPath = path.join(ROOT, "tsconfig.json");
  if (fs.existsSync(tsconfigPath)) {
    const tsconfig = readJsonFile(tsconfigPath);
    tsconfig.compilerOptions = {
      ...(tsconfig.compilerOptions ?? {}),
      strict: true,
      noEmit: true,
      paths: {
        ...(tsconfig.compilerOptions?.paths ?? {}),
        "@/*": ["./src/*"],
      },
    };
    const includes = new Set(tsconfig.include ?? []);
    includes.add("src/**/*.ts");
    includes.add("src/**/*.tsx");
    includes.add("tests/**/*.ts");
    tsconfig.include = Array.from(includes);

    const excludes = new Set(tsconfig.exclude ?? ["node_modules"]);
    excludes.add("dist");
    excludes.add(".vinext");
    excludes.add(".wrangler");
    excludes.add("scripts/bootstrap");
    tsconfig.exclude = Array.from(excludes);

    fs.writeFileSync(tsconfigPath, `${JSON.stringify(tsconfig, null, 2)}\n`, "utf8");
    console.log("  ✓ Updated tsconfig.json (strict: true, @/* alias)");
  }

  writeFileEnsureDir(
    ".prettierrc",
    `${JSON.stringify(
      {
        semi: true,
        singleQuote: false,
        tabWidth: 2,
        trailingComma: "es5",
        printWidth: 100,
      },
      null,
      2
    )}\n`
  );

  writeFileEnsureDir(
    ".prettierignore",
    [
      "node_modules",
      "dist",
      ".vinext",
      ".next",
      ".wrangler",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "scripts/bootstrap",
      "PROGRESS.md",
      "",
    ].join("\n")
  );

  writeFileEnsureDir(
    "eslint.config.mjs",
    `import js from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      ".vinext/**",
      ".next/**",
      ".wrangler/**",
      "scripts/bootstrap/**",
      "next-env.d.ts",
      "cloudflare-env.d.ts",
      "worker-configuration.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  eslintConfigPrettier
);
`
  );

  writeFileEnsureDir(
    "vitest.config.ts",
    `import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
`
  );

  writeFileEnsureDir(
    ".gitignore",
    [
      "# Dependencies",
      "node_modules/",
      "",
      "# Build & runtime outputs",
      "dist/",
      ".vinext/",
      ".next/",
      ".wrangler/",
      ".tmp-scaffold/",
      "coverage/",
      "*.tsbuildinfo",
      "",
      "# Secrets & local env (NEVER commit secrets)",
      ".dev.vars",
      ".dev.vars.*",
      "!.dev.vars.example",
      ".env",
      ".env.*",
      "!.env.example",
      "",
      "# OS & editor",
      ".DS_Store",
      "Thumbs.db",
      "",
    ].join("\n")
  );

  writeFileEnsureDir(
    ".dev.vars.example",
    [
      "# Copy to .dev.vars for local Workers development. Never commit .dev.vars.",
      "# Production and staging secrets are set via: wrangler secret put <NAME> --env <staging|prod>",
      "ANTHROPIC_API_KEY=",
      "CLOUDFLARE_AI_GATEWAY_ID=",
      "SENTRY_DSN=",
      "",
    ].join("\n")
  );

  writeFileEnsureDir(
    "PROGRESS.md",
    `# Collate — Build Progress

Track progress strictly one phase at a time. Do not begin the next phase until the previous phase's **Done when** checks pass.

## Phase 0 — Foundations and Cloudflare infrastructure
- [x] Step 0.1: Create repo (TypeScript, pnpm, ESLint, Prettier, Vitest, \`PROGRESS.md\`)
- [x] Step 0.1: Scaffold Next.js for Cloudflare Workers (\`vinext\` + \`wrangler.jsonc\`) with error boundaries and \`/api/health\`
- [ ] Step 0.2: Create environments (\`dev\`, \`staging\`, \`prod\`) with D1, R2, Queues, Vectorize, Workflows
- [ ] Step 0.2: Drizzle + D1 migrations + seed script
- [ ] Step 0.3: AI Gateway configured + \`callLLM()\` helper logging tokens and cost to \`jobs_log\`
- [ ] Step 0.4: Domain on Cloudflare DNS + secrets via \`wrangler secret\`
- [ ] Step 0.4: Observability (Workers Logs, Sentry, error boundary) + GitHub Actions CI
- [ ] Step 0.4: Hello-world Workflow (1-min sleep & resume) + hello-world Browser Run \`/pdf\` → R2

### Phase 0 — Done when
- [ ] Staging URL serves a page from Workers.
- [ ] A test Workflow runs, sleeps for 1 minute, and resumes.
- [ ] A test HTML renders to PDF via Browser Run and lands in R2.
- [ ] Cost per LLM call is being logged.

---

## Upcoming Phases
- [ ] Phase 1 — Accounts and dashboard shell
- [ ] Phase 2 — Setup wizard (UI + persistence, no AI yet)
- [ ] Phase 3 — Research engine
- [ ] Phase 4 — Feasibility gate and page recommendation
- [ ] Phase 5 — Outline and chapter planning
- [ ] Phase 6 — Citation engine
- [ ] Phase 7 — Chapter writing pipeline
- [ ] Phase 8 — Originality and integrity
- [ ] Phase 9 — PDF and DOCX export
- [ ] Phase 10 — Dashboard project view and notifications
- [ ] Phase 11 — Payments, credits and cost control
- [ ] Phase 12 — Hardening, QA, launch
`
  );
}

function writeAppShellAndTests() {
  logStep("7. Writing core health domain module, API route, error boundaries, shell UI, and tests");

  const appDir = fs.existsSync(path.join(ROOT, "src", "app")) ? "src/app" : "app";
  const healthImportFromRoute =
    appDir === "src/app" ? "../../../lib/health" : "../../../src/lib/health";

  writeFileEnsureDir(
    "src/lib/health.ts",
    `import { z } from "zod";

export const AppEnvSchema = z.enum(["dev", "staging", "prod"]);
export type AppEnv = z.infer<typeof AppEnvSchema>;

export const HealthPayloadSchema = z.object({
  ok: z.literal(true),
  app: z.string().min(1),
  environment: AppEnvSchema,
  phase: z.string().min(1),
  timestamp: z.string().datetime(),
});

export type HealthPayload = z.infer<typeof HealthPayloadSchema>;

export interface BuildHealthInput {
  appName?: string;
  environment?: string;
  now?: Date;
}

/**
 * Pure domain helper for /api/health.
 * Validates environment explicitly instead of trusting unvalidated runtime strings.
 */
export function buildHealthPayload(input: BuildHealthInput = {}): HealthPayload {
  const parsedEnv = AppEnvSchema.safeParse(input.environment ?? "dev");
  const environment: AppEnv = parsedEnv.success ? parsedEnv.data : "dev";

  const appName = input.appName?.trim() || "Collate";
  const now = input.now ?? new Date();

  if (Number.isNaN(now.getTime())) {
    throw new Error("Invalid Date supplied to buildHealthPayload");
  }

  return HealthPayloadSchema.parse({
    ok: true,
    app: appName,
    environment,
    phase: "0.1-foundations",
    timestamp: now.toISOString(),
  });
}
`
  );

  writeFileEnsureDir(
    `${appDir}/api/health/route.ts`,
    `import { buildHealthPayload } from "${healthImportFromRoute}";

export async function GET(): Promise<Response> {
  const payload = buildHealthPayload({
    appName: process.env.APP_NAME ?? "Collate",
    environment: process.env.APP_ENV ?? "dev",
  });

  return Response.json(payload, {
    status: 200,
    headers: {
      "cache-control": "no-store",
    },
  });
}
`
  );

  writeFileEnsureDir(
    `${appDir}/error.tsx`,
    `"use client";

import { useEffect } from "react";

interface ErrorBoundaryProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function AppError({ error, reset }: ErrorBoundaryProps) {
  useEffect(() => {
    console.error("[Collate] Unhandled route error:", error.message, error.digest ?? "");
  }, [error]);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "2rem",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        backgroundColor: "#faf9f7",
        color: "#18181b",
      }}
    >
      <section
        role="alert"
        style={{
          maxWidth: "32rem",
          width: "100%",
          background: "#ffffff",
          border: "1px solid #e4e4e7",
          borderRadius: "12px",
          padding: "2rem",
        }}
      >
        <p
          style={{
            fontSize: "0.75rem",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "#71717a",
            margin: 0,
          }}
        >
          Collate
        </p>
        <h1 style={{ fontSize: "1.375rem", margin: "0.5rem 0 0.75rem" }}>Something went wrong</h1>
        <p style={{ color: "#52525b", lineHeight: 1.6, margin: "0 0 1.25rem" }}>
          An unexpected error occurred while rendering this page. Your work is safe—please try
          again.
        </p>
        {error.digest ? (
          <p style={{ fontSize: "0.75rem", color: "#71717a", margin: "0 0 1.25rem" }}>
            Reference ID: <code>{error.digest}</code>
          </p>
        ) : null}
        <button
          type="button"
          onClick={reset}
          style={{
            backgroundColor: "#18181b",
            color: "#ffffff",
            border: "none",
            borderRadius: "8px",
            padding: "0.625rem 1.125rem",
            fontSize: "0.875rem",
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </section>
    </main>
  );
}
`
  );

  writeFileEnsureDir(
    `${appDir}/global-error.tsx`,
    `"use client";

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  return (
    <html lang="en">
      <body
        style={{
          minHeight: "100vh",
          margin: 0,
          display: "grid",
          placeItems: "center",
          padding: "2rem",
          fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          backgroundColor: "#faf9f7",
          color: "#18181b",
        }}
      >
        <main
          role="alert"
          style={{
            maxWidth: "32rem",
            width: "100%",
            background: "#ffffff",
            border: "1px solid #e4e4e7",
            borderRadius: "12px",
            padding: "2rem",
          }}
        >
          <h1 style={{ fontSize: "1.375rem", margin: "0 0 0.75rem" }}>Application error</h1>
          <p style={{ color: "#52525b", lineHeight: 1.6, margin: "0 0 1.25rem" }}>
            Collate encountered an unexpected error. Please reload to continue.
          </p>
          {error.digest ? (
            <p style={{ fontSize: "0.75rem", color: "#71717a", margin: "0 0 1.25rem" }}>
              Reference ID: <code>{error.digest}</code>
            </p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            style={{
              backgroundColor: "#18181b",
              color: "#ffffff",
              border: "none",
              borderRadius: "8px",
              padding: "0.625rem 1.125rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </main>
      </body>
    </html>
  );
}
`
  );

  writeFileEnsureDir(
    `${appDir}/page.tsx`,
    `export default function HomePage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        backgroundColor: "#faf9f7",
        color: "#18181b",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        display: "grid",
        placeItems: "center",
        padding: "2rem",
      }}
    >
      <div
        style={{
          maxWidth: "42rem",
          width: "100%",
          backgroundColor: "#ffffff",
          border: "1px solid #e4e4e7",
          borderRadius: "14px",
          padding: "2.5rem",
          boxShadow: "0 1px 2px rgba(0, 0, 0, 0.04)",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.5rem",
            fontSize: "0.75rem",
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "#3f3f46",
            backgroundColor: "#f4f4f5",
            padding: "0.35rem 0.7rem",
            borderRadius: "999px",
          }}
        >
          Phase 0 · Foundations Active
        </div>

        <h1
          style={{
            fontSize: "2.25rem",
            letterSpacing: "-0.025em",
            margin: "1.25rem 0 0.75rem",
            lineHeight: 1.15,
          }}
        >
          Collate
        </h1>

        <p
          style={{
            fontSize: "1.0625rem",
            lineHeight: 1.65,
            color: "#3f3f46",
            margin: "0 0 1.75rem",
          }}
        >
          Evidence-bound research and long-form academic drafting—built chapter by chapter on
          verified sources, real citations, and server-side typesetting.
        </p>

        <div
          style={{
            borderTop: "1px solid #e4e4e7",
            paddingTop: "1.25rem",
            display: "flex",
            flexWrap: "wrap",
            gap: "1rem",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: "0.875rem",
            color: "#52525b",
          }}
        >
          <span>Runtime: Cloudflare Workers (vinext)</span>
          <a
            href="/api/health"
            style={{
              color: "#18181b",
              fontWeight: 500,
              textDecoration: "underline",
              textUnderlineOffset: "3px",
            }}
          >
            Inspect /api/health →
          </a>
        </div>
      </div>
    </main>
  );
}
`
  );

  writeFileEnsureDir(
    "tests/health.test.ts",
    `import { describe, expect, it } from "vitest";
import { buildHealthPayload, HealthPayloadSchema } from "@/lib/health";

describe("buildHealthPayload", () => {
  it("returns a valid default payload", () => {
    const fixedDate = new Date("2026-11-21T12:00:00.000Z");
    const result = buildHealthPayload({ now: fixedDate });

    expect(result).toEqual({
      ok: true,
      app: "Collate",
      environment: "dev",
      phase: "0.1-foundations",
      timestamp: "2026-11-21T12:00:00.000Z",
    });
    expect(HealthPayloadSchema.safeParse(result).success).toBe(true);
  });

  it("accepts staging and prod environments", () => {
    expect(buildHealthPayload({ environment: "staging" }).environment).toBe("staging");
    expect(buildHealthPayload({ environment: "prod" }).environment).toBe("prod");
  });

  it("falls back safely to dev when environment is unknown", () => {
    expect(buildHealthPayload({ environment: "unknown-env" }).environment).toBe("dev");
  });

  it("trims whitespace and falls back to Collate for blank appName", () => {
    expect(buildHealthPayload({ appName: "   " }).app).toBe("Collate");
    expect(buildHealthPayload({ appName: "  Collate Staging  " }).app).toBe("Collate Staging");
  });

  it("throws explicitly on an invalid Date", () => {
    expect(() => buildHealthPayload({ now: new Date("not-a-date") })).toThrow(
      "Invalid Date supplied to buildHealthPayload"
    );
  });
});
`
  );
}

function initGitIfNeeded() {
  logStep("8. Ensuring Git repository is initialized");
  if (fs.existsSync(path.join(ROOT, ".git"))) {
    console.log("  ℹ Git repository already initialized.");
    return;
  }
  run("git", ["init", "-b", "main"]);
  console.log("  ✓ Initialized git repository on branch 'main'");
}

function verifyAll() {
  logStep("9. Formatting and running verification gate");

  run("pnpm", ["run", "format"]);
  run("pnpm", ["run", "typecheck"]);
  run("pnpm", ["run", "lint"]);
  run("pnpm", ["run", "format:check"]);
  run("pnpm", ["run", "test"]);
  run("pnpm", ["run", "build"]);
}

function main() {
  console.log("Collate — Phase 0 / Step 0.1 Bootstrap");
  console.log(`Target directory: ${ROOT}`);

  checkPrerequisites();
  scaffoldVinextApp();
  configurePackageAndPnpm();
  installDependencies();
  configureWrangler();
  configureToolingAndRepoFiles();
  writeAppShellAndTests();
  initGitIfNeeded();
  verifyAll();

  console.log("\n========================================");
  console.log("✓ Step 0.1 PASSED all verification gates!");
  console.log("========================================");
  console.log("Next:");
  console.log("  1. Run 'pnpm run dev' to preview Collate locally in your browser.");
  console.log("  2. Visit http://localhost:5173 (or the URL printed) and /api/health.");
  console.log("  3. Paste the summary here so we can move to Step 0.2 (Cloudflare bindings + Drizzle/D1).");
}

main();
