import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const ROOT = process.cwd();
export const IS_WIN = process.platform === "win32";
export const LOG_FILE_NAME = "last-run-output.txt";
export const LOG_FILE_PATH = path.join(ROOT, LOG_FILE_NAME);

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\u001b\[[0-9;]*[a-zA-Z]/g;

function stripAnsi(text) {
  return text.replace(ANSI_PATTERN, "");
}

function quoteWinArg(arg) {
  if (!/[\s"&|<>^()]/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '\\"')}"`;
}

export function createStepRunner(stepTitle) {
  const buffer = [];
  const startedAt = new Date().toISOString();

  function record(line = "") {
    const text = `${line}\n`;
    process.stdout.write(text);
    buffer.push(stripAnsi(text));
  }

  function recordError(line = "") {
    const text = `${line}\n`;
    process.stderr.write(text);
    buffer.push(stripAnsi(text));
  }

  function flushLog() {
    fs.writeFileSync(LOG_FILE_PATH, buffer.join(""), "utf8");
  }

  function ensureLogIgnored() {
    for (const ignoreFile of [".gitignore", ".prettierignore"]) {
      const fullPath = path.join(ROOT, ignoreFile);
      const existing = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, "utf8") : "";
      const lines = existing.split(/\r?\n/);
      if (!lines.includes(LOG_FILE_NAME)) {
        const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
        fs.writeFileSync(fullPath, `${existing}${prefix}${LOG_FILE_NAME}\n`, "utf8");
      }
    }
  }

  function logStep(title) {
    record("");
    record("========================================");
    record(`▶ ${title}`);
    record("========================================");
  }

  function writeFileEnsureDir(relPath, content) {
    const fullPath = path.join(ROOT, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, "utf8");
    record(`  ✓ wrote ${relPath}`);
  }

  function run(cmd, args = [], options = {}) {
    const { allowFail = false, cwd = ROOT, nonInteractive = true } = options;
    const finalArgs = IS_WIN ? args.map(quoteWinArg) : args;

    return new Promise((resolve, reject) => {
      const child = spawn(cmd, finalArgs, {
        cwd,
        shell: IS_WIN,
        env: nonInteractive ? { ...process.env, CI: "true" } : process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        const text = chunk.toString("utf8");
        stdout += text;
        process.stdout.write(text);
        buffer.push(stripAnsi(text));
      });

      child.stderr.on("data", (chunk) => {
        const text = chunk.toString("utf8");
        stderr += text;
        process.stderr.write(text);
        buffer.push(stripAnsi(text));
      });

      child.on("error", (err) => {
        if (allowFail) {
          resolve({ ok: false, code: 1, stdout: stdout.trim(), stderr: err.message });
          return;
        }
        reject(new Error(`Failed to launch command: ${cmd} ${args.join(" ")} (${err.message})`));
      });

      child.on("close", (code) => {
        const ok = code === 0;
        if (!ok && !allowFail) {
          reject(new Error(`Command exited with code ${code}: ${cmd} ${args.join(" ")}`));
          return;
        }
        resolve({ ok, code: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() });
      });
    });
  }

  async function gitCommit(message) {
    logStep("Git commit (local only, no push)");
    ensureLogIgnored();
    await run("git", ["add", "."]);
    const status = await run("git", ["status", "--porcelain"], { allowFail: false });
    if (!status.stdout) {
      record("  ℹ Working tree clean — nothing new to commit.");
      return;
    }
    await run("git", ["commit", "-m", message]);
    await run("git", ["log", "-1", "--oneline"]);
  }

  async function execute(fn) {
    ensureLogIgnored();
    record(`Collate — ${stepTitle}`);
    record(`Started: ${startedAt}`);
    record(`Directory: ${ROOT}`);
    try {
      await fn();
      record("");
      record(`Saved full terminal output to ${LOG_FILE_NAME} (git-ignored).`);
      flushLog();
    } catch (err) {
      recordError("");
      recordError(`✖ ERROR: ${err instanceof Error ? err.message : String(err)}`);
      recordError(`Full failure output saved to ${LOG_FILE_NAME} (git-ignored).`);
      flushLog();
      process.exit(1);
    }
  }

  return {
    log: record,
    logStep,
    writeFileEnsureDir,
    run,
    gitCommit,
    execute,
  };
}
