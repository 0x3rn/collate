"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDownIcon } from "@/components/layout/workspace-icons";

export interface CustomSelectOption<T extends string = string> {
  value: T;
  label: string;
  description?: string;
}

export function CustomSelect<T extends string = string>({
  id,
  value,
  options,
  onChange,
  placeholder = "Select an option",
  ariaLabel,
  disabled = false,
  size = "md",
  align = "left",
  className = "",
  buttonClassName = "",
}: {
  id?: string;
  value: T;
  options: ReadonlyArray<CustomSelectOption<T>>;
  onChange: (nextValue: T) => void;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  size?: "sm" | "md";
  align?: "left" | "right";
  className?: string;
  buttonClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listboxId = useId();

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : undefined;

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
        triggerRef.current?.focus();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlightedIndex((prev) =>
          options.length === 0 ? -1 : prev < options.length - 1 ? prev + 1 : 0
        );
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlightedIndex((prev) =>
          options.length === 0 ? -1 : prev > 0 ? prev - 1 : options.length - 1
        );
      } else if (event.key === "Enter" || event.key === " ") {
        if (highlightedIndex >= 0 && highlightedIndex < options.length) {
          event.preventDefault();
          const chosen = options[highlightedIndex]!;
          onChange(chosen.value);
          setOpen(false);
          triggerRef.current?.focus();
        }
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, highlightedIndex, options, onChange]);

  function handleToggle() {
    if (disabled) return;
    setOpen((prev) => {
      const next = !prev;
      if (next) {
        setHighlightedIndex(selectedIndex >= 0 ? selectedIndex : 0);
      }
      return next;
    });
  }

  function handleSelect(optionValue: T) {
    onChange(optionValue);
    setOpen(false);
    triggerRef.current?.focus();
  }

  const sizeClasses =
    size === "sm"
      ? "min-h-[38px] px-3 py-1.5 text-sm"
      : "min-h-[44px] px-3.5 py-2.5 text-sm sm:text-[0.9375rem]";

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={handleToggle}
        className={`w-full inline-flex items-center justify-between gap-2.5 ${sizeClasses} bg-white text-[var(--neutral-900)] border border-[var(--neutral-300)] rounded-[var(--radius-sm)] hover:border-[var(--neutral-400)] focus-visible:outline-none focus-visible:border-[var(--accent-600)] focus-visible:ring-2 focus-visible:ring-[var(--accent-600)]/20 disabled:opacity-60 disabled:cursor-not-allowed transition-colors cursor-pointer ${buttonClassName}`}
      >
        <span
          className={`truncate text-left ${
            selectedOption ? "text-[var(--neutral-900)]" : "text-[var(--neutral-500)]"
          }`}
        >
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDownIcon
          className={`w-4 h-4 shrink-0 text-[var(--neutral-500)] transition-transform duration-150 ${
            open ? "rotate-180 text-[var(--accent-600)]" : ""
          }`}
        />
      </button>

      {open ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel ?? placeholder}
          className={`absolute ${
            align === "right" ? "right-0" : "left-0"
          } mt-1.5 w-full min-w-[200px] max-h-[260px] overflow-y-auto rounded-[var(--radius-md)] border border-[var(--neutral-200)] bg-white py-1.5 shadow-[0_12px_32px_-8px_rgba(23,22,20,0.14),0_2px_6px_-1px_rgba(23,22,20,0.06)] z-40`}
        >
          {options.map((opt, idx) => {
            const isSelected = opt.value === value;
            const isHighlighted = idx === highlightedIndex;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setHighlightedIndex(idx)}
                onClick={() => handleSelect(opt.value)}
                className={`w-full px-3.5 py-2.5 text-left flex items-start justify-between gap-3 transition-colors cursor-pointer ${
                  isSelected
                    ? "bg-[var(--accent-100)]/65 text-[var(--accent-700)]"
                    : isHighlighted
                      ? "bg-[var(--neutral-50)] text-[var(--neutral-900)]"
                      : "text-[var(--neutral-800)] hover:bg-[var(--neutral-50)]"
                }`}
              >
                <span className="flex flex-col gap-0.5 min-w-0">
                  <span
                    className={`text-sm leading-snug ${isSelected ? "font-semibold" : "font-medium"}`}
                  >
                    {opt.label}
                  </span>
                  {opt.description ? (
                    <span className="text-xs text-[var(--neutral-500)] leading-snug">
                      {opt.description}
                    </span>
                  ) : null}
                </span>
                {isSelected ? (
                  <svg
                    viewBox="0 0 20 20"
                    fill="none"
                    aria-hidden="true"
                    className="w-4 h-4 shrink-0 mt-0.5 text-[var(--accent-600)]"
                  >
                    <path
                      d="M4.5 10.5 8.2 14.2 15.5 6.5"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
