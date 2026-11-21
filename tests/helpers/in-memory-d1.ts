import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

interface D1MetaShape {
  duration: number;
  size_after: number;
  rows_read: number;
  rows_written: number;
  last_row_id: number;
  changed_db: boolean;
  changes: number;
}

function emptyMeta(changes = 0, lastRowId = 0): D1MetaShape {
  return {
    duration: 0,
    size_after: 0,
    rows_read: 0,
    rows_written: changes,
    last_row_id: lastRowId,
    changed_db: changes > 0,
    changes,
  };
}

function toSqlInput(value: unknown): SQLInputValue {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "string") {
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    return value as NodeJS.ArrayBufferView;
  }
  throw new Error(`Unsupported SQLite bind parameter type: ${typeof value}`);
}

interface BoundStatement {
  bind(...values: unknown[]): BoundStatement;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<{ results: T[]; success: true; meta: D1MetaShape }>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: true; meta: D1MetaShape }>;
  raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]>;
}

export interface InMemoryD1Context {
  d1: D1Database;
  sqlite: DatabaseSync;
  applyMigrations(migrationsDir?: string): void;
  execSqlFile(filePath: string): void;
  close(): void;
}

/**
 * Lightweight, zero-native-build D1Database adapter backed by Node's built-in node:sqlite.
 * Enforces PRAGMA foreign_keys = ON so tests exercise real SQLite constraints and migrations.
 */
export function createInMemoryD1(): InMemoryD1Context {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");

  function createStatement(sqlText: string, boundParams: SQLInputValue[] = []): BoundStatement {
    return {
      bind(...values: unknown[]): BoundStatement {
        return createStatement(sqlText, values.map(toSqlInput));
      },

      async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
        const stmt = sqlite.prepare(sqlText);
        const row = stmt.get(...boundParams) as Record<string, unknown> | undefined;
        if (!row) return null;
        if (colName !== undefined) {
          return (row[colName] ?? null) as T | null;
        }
        return row as T;
      },

      async run<T = Record<string, unknown>>(): Promise<{
        results: T[];
        success: true;
        meta: D1MetaShape;
      }> {
        const stmt = sqlite.prepare(sqlText);
        const info = stmt.run(...boundParams);
        return {
          results: [],
          success: true,
          meta: emptyMeta(Number(info.changes), Number(info.lastInsertRowid)),
        };
      },

      async all<T = Record<string, unknown>>(): Promise<{
        results: T[];
        success: true;
        meta: D1MetaShape;
      }> {
        const stmt = sqlite.prepare(sqlText);
        const rows = stmt.all(...boundParams) as unknown as T[];
        return {
          results: rows,
          success: true,
          meta: { ...emptyMeta(), rows_read: rows.length },
        };
      },

      async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]> {
        const stmt = sqlite.prepare(sqlText);
        stmt.setReturnArrays(true);
        const rows = stmt.all(...boundParams) as unknown as unknown[][];
        if (options?.columnNames) {
          const cols = stmt.columns().map((c) => c.name);
          return [cols, ...rows] as unknown as T[];
        }
        return rows as unknown as T[];
      },
    };
  }

  const d1Like = {
    prepare(query: string): BoundStatement {
      return createStatement(query);
    },
    async batch<T = unknown>(statements: BoundStatement[]): Promise<T[]> {
      sqlite.exec("BEGIN");
      try {
        const results: T[] = [];
        for (const stmt of statements) {
          results.push((await stmt.all()) as unknown as T);
        }
        sqlite.exec("COMMIT");
        return results;
      } catch (err) {
        sqlite.exec("ROLLBACK");
        throw err;
      }
    },
    async exec(query: string): Promise<{ count: number; duration: number }> {
      sqlite.exec(query);
      return { count: 1, duration: 0 };
    },
    async dump(): Promise<ArrayBuffer> {
      return new ArrayBuffer(0);
    },
  };

  function applyMigrations(migrationsDir = path.resolve(process.cwd(), "drizzle")): void {
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    if (files.length === 0) {
      throw new Error(`No .sql migration files found in ${migrationsDir}`);
    }

    for (const file of files) {
      const content = fs.readFileSync(path.join(migrationsDir, file), "utf8");
      const statements = content
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter(Boolean);

      for (const stmt of statements) {
        sqlite.exec(stmt);
      }
    }
  }

  function execSqlFile(filePath: string): void {
    const content = fs.readFileSync(filePath, "utf8");
    sqlite.exec(content);
  }

  return {
    d1: d1Like as unknown as D1Database,
    sqlite,
    applyMigrations,
    execSqlFile,
    close(): void {
      sqlite.close();
    },
  };
}
