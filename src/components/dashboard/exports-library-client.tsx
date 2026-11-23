"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { DownloadIcon, SearchIcon } from "@/components/layout/workspace-icons";
import { Button, LinkButton } from "@/components/ui/button";
import type { UserExportItem } from "@/db/queries/dashboard";
import type { ExportFormat } from "@/db/schema";
import {
  formatExportFormat,
  formatExportScope,
  formatFileSize,
  formatProjectType,
  formatShortDate,
} from "@/lib/ui/formatters";

type FormatFilter = "all" | ExportFormat;

export function ExportsLibraryClient({ exportsList }: { exportsList: UserExportItem[] }) {
  const [formatFilter, setFormatFilter] = useState<FormatFilter>("all");
  const [query, setQuery] = useState("");

  const counts = useMemo(() => {
    let pdf = 0;
    let docx = 0;
    for (const item of exportsList) {
      if (item.format === "pdf") pdf += 1;
      else docx += 1;
    }
    return { all: exportsList.length, pdf, docx };
  }, [exportsList]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return exportsList.filter((item) => {
      if (formatFilter !== "all" && item.format !== formatFilter) return false;
      if (!q) return true;
      return `${item.projectTitle} ${item.chapterTitle ?? ""}`.toLowerCase().includes(q);
    });
  }, [exportsList, formatFilter, query]);

  if (exportsList.length === 0) {
    return (
      <section
        aria-label="Empty exports library"
        className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-8 sm:p-12"
      >
        <div className="max-w-[560px] mx-auto text-center space-y-5">
          <img
            src="/images/empty-exports.jpg"
            alt=""
            width={800}
            height={597}
            className="w-56 sm:w-64 h-auto mx-auto rounded-[var(--radius-sm)]"
          />
          <div className="space-y-2">
            <h2 className="text-2xl font-medium m-0">No exported files yet</h2>
            <p className="text-sm sm:text-base text-[var(--neutral-600)] leading-relaxed m-0">
              Once you export a chapter or finished manuscript to PDF or Word (.docx) inside a
              project, it will stay listed here for quick re-download.
            </p>
          </div>
          <div className="pt-1 flex flex-wrap items-center justify-center gap-3">
            <LinkButton href="/projects" variant="primary">
              Go to projects
            </LinkButton>
            <LinkButton href="/projects/new" variant="secondary">
              Start a new project
            </LinkButton>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filter bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[var(--neutral-200)]">
        <div
          role="tablist"
          aria-label="Filter exports by format"
          className="flex flex-wrap gap-1.5"
        >
          {(
            [
              { id: "all", label: "All files", count: counts.all },
              { id: "pdf", label: "PDF", count: counts.pdf },
              { id: "docx", label: "Word (.docx)", count: counts.docx },
            ] as const
          ).map((tab) => {
            const selected = formatFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setFormatFilter(tab.id)}
                className={`min-h-[38px] px-3 py-1.5 rounded-[var(--radius-sm)] text-sm font-medium inline-flex items-center gap-2 border transition-colors cursor-pointer ${
                  selected
                    ? "bg-[var(--accent-600)] text-white border-[var(--accent-600)]"
                    : "bg-white text-[var(--neutral-700)] border-[var(--neutral-200)] hover:border-[var(--neutral-300)]"
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`text-xs tabular-nums px-1.5 py-0.5 rounded-[4px] ${
                    selected
                      ? "bg-white/15 text-white"
                      : "bg-[var(--neutral-100)] text-[var(--neutral-600)]"
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="relative sm:w-64">
          <label htmlFor="exports-search" className="sr-only">
            Search exports
          </label>
          <SearchIcon className="w-4 h-4 text-[var(--neutral-400)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            id="exports-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by project title..."
            className="w-full min-h-[40px] pl-9 pr-3 py-2 text-sm bg-white border border-[var(--neutral-300)] rounded-[var(--radius-sm)] text-[var(--neutral-900)] placeholder:text-[var(--neutral-400)]"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <section className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-8 text-center space-y-3">
          <h2 className="text-lg font-medium m-0">No matching files</h2>
          <p className="text-sm text-[var(--neutral-600)] m-0">
            No saved exports match that filter.
          </p>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setFormatFilter("all");
              setQuery("");
            }}
          >
            Show all exports
          </Button>
        </section>
      ) : (
        <section className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] overflow-hidden">
          {/* Desktop table header */}
          <div className="hidden md:grid md:grid-cols-12 gap-4 px-5 py-3 bg-[var(--neutral-100)] border-b border-[var(--neutral-200)] text-xs font-semibold uppercase tracking-wider text-[var(--neutral-600)]">
            <div className="col-span-5">Project &amp; document</div>
            <div className="col-span-2">Format</div>
            <div className="col-span-2">Details</div>
            <div className="col-span-3 text-right">Action</div>
          </div>

          <ul className="divide-y divide-[var(--neutral-200)] list-none p-0 m-0">
            {filtered.map((item) => (
              <li
                key={item.id}
                className="px-5 py-4 grid grid-cols-1 md:grid-cols-12 gap-3 md:gap-4 items-start md:items-center"
              >
                <div className="md:col-span-5 min-w-0 space-y-0.5">
                  <Link
                    href={`/projects/${item.projectId}`}
                    className="text-sm font-semibold text-[var(--neutral-900)] hover:text-[var(--accent-600)] block truncate"
                  >
                    {item.projectTitle}
                  </Link>
                  <p className="text-xs text-[var(--neutral-600)] m-0">
                    {formatProjectType(item.projectType)} ·{" "}
                    {formatExportScope(item.scope, item.chapterNumber)}
                    {item.chapterTitle ? ` (${item.chapterTitle})` : ""}
                  </p>
                </div>

                <div className="md:col-span-2">
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 text-xs font-medium rounded-[var(--radius-sm)] border ${
                      item.format === "pdf"
                        ? "bg-[var(--accent-100)] text-[var(--accent-600)] border-[var(--info-border)]"
                        : "bg-[var(--neutral-100)] text-[var(--neutral-700)] border-[var(--neutral-200)]"
                    }`}
                  >
                    {formatExportFormat(item.format)}
                  </span>
                </div>

                <div className="md:col-span-2 text-xs text-[var(--neutral-600)] tabular-nums space-y-0.5">
                  <p className="m-0 text-[var(--neutral-800)] font-medium">
                    {item.pageCount > 0 ? `${item.pageCount} pages` : "Document"} ·{" "}
                    {formatFileSize(item.sizeBytes)}
                  </p>
                  <p className="m-0">{formatShortDate(item.createdAt)}</p>
                </div>

                <div className="md:col-span-3 flex items-center md:justify-end gap-2">
                  {item.downloadUrl ? (
                    <a
                      href={item.downloadUrl}
                      className="min-h-[38px] px-3.5 py-1.5 rounded-[var(--radius-sm)] border border-[var(--neutral-300)] bg-white hover:bg-[var(--neutral-100)] text-sm font-medium text-[var(--neutral-900)] inline-flex items-center gap-1.5 transition-colors"
                    >
                      <DownloadIcon className="w-4 h-4 text-[var(--accent-600)]" />
                      <span>Download</span>
                    </a>
                  ) : (
                    <Link
                      href={`/projects/${item.projectId}`}
                      className="text-sm font-medium text-[var(--accent-600)] hover:underline underline-offset-4"
                    >
                      Open project
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
