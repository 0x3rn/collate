"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDownIcon, DownloadIcon } from "@/components/layout/workspace-icons";
import { SpinnerIcon } from "@/components/ui/button";

export type DownloadExportFormat = "pdf" | "docx";

export function DownloadMenuButton({
  label = "Download",
  disabled = false,
  loadingFormat = null,
  onSelectFormat,
  align = "right",
  className = "",
}: {
  label?: string;
  disabled?: boolean;
  loadingFormat?: DownloadExportFormat | null;
  onSelectFormat: (format: DownloadExportFormat) => void;
  align?: "left" | "right";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isLoading = loadingFormat !== null;

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function handleChoose(format: DownloadExportFormat) {
    setOpen(false);
    onSelectFormat(format);
  }

  return (
    <div ref={containerRef} className={`relative inline-block ${className}`}>
      <button
        type="button"
        disabled={disabled || isLoading}
        aria-busy={isLoading || undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="w-full inline-grid place-items-center min-h-[42px] px-3.5 sm:px-4 py-2 text-sm font-medium rounded-[var(--radius-sm)] bg-white text-[var(--neutral-900)] border border-[var(--neutral-300)] hover:bg-[var(--neutral-100)] hover:border-[var(--neutral-400)] active:translate-y-[0.5px] disabled:opacity-60 disabled:cursor-not-allowed transition-colors duration-150 cursor-pointer"
      >
        {/* Fixed-width intrinsic layer prevents ANY width jump or row reflow while exporting */}
        <span
          aria-hidden={isLoading || undefined}
          className={`col-start-1 row-start-1 inline-flex items-center justify-center gap-2 whitespace-nowrap ${
            isLoading ? "invisible" : ""
          }`}
        >
          <DownloadIcon className="w-4 h-4 shrink-0" />
          <span>{label}</span>
          <ChevronDownIcon
            className={`w-4 h-4 shrink-0 transition-transform duration-150 ${
              open ? "rotate-180" : ""
            }`}
          />
        </span>

        {isLoading ? (
          <span className="col-start-1 row-start-1 inline-flex items-center justify-center gap-1.5 whitespace-nowrap">
            <SpinnerIcon className="w-4 h-4" />
            <span>{loadingFormat === "docx" ? "Word..." : "PDF..."}</span>
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Choose download format"
          className={`absolute ${
            align === "left" ? "left-0" : "right-0"
          } mt-1.5 min-w-[220px] rounded-[var(--radius-md)] border border-[var(--neutral-200)] bg-white py-1.5 shadow-[0_12px_32px_-8px_rgba(23,22,20,0.14),0_2px_6px_-1px_rgba(23,22,20,0.06)] z-30`}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => handleChoose("pdf")}
            className="w-full px-3.5 py-2.5 text-left flex flex-col gap-0.5 hover:bg-[var(--neutral-50)] focus-visible:bg-[var(--neutral-50)] focus-visible:outline-none transition-colors cursor-pointer"
          >
            <span className="text-sm font-medium text-[var(--neutral-900)]">Download PDF</span>
            <span className="text-xs text-[var(--neutral-500)]">Print-ready layout (.pdf)</span>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => handleChoose("docx")}
            className="w-full px-3.5 py-2.5 text-left flex flex-col gap-0.5 hover:bg-[var(--neutral-50)] focus-visible:bg-[var(--neutral-50)] focus-visible:outline-none transition-colors cursor-pointer"
          >
            <span className="text-sm font-medium text-[var(--neutral-900)]">
              Download Word (.docx)
            </span>
            <span className="text-xs text-[var(--neutral-500)]">Editable Microsoft Word file</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
