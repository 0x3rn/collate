"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { FormAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ModalCard } from "@/components/ui/modal-card";
import { useToast } from "@/components/ui/toast";

/** The "⋯" menu at the end of a project row, with Delete behind a confirmation pop-up. */
export function ProjectRowMenu({
  projectId,
  projectTitle,
}: {
  projectId: string;
  projectTitle: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointer(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  async function remove() {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
        method: "DELETE",
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "We could not delete this project. Try again.");
        return;
      }
      setConfirmOpen(false);
      toast.success(`“${projectTitle}” was deleted.`, "Project deleted");
      router.refresh();
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        aria-label={`More actions for ${projectTitle}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((v) => !v)}
        className="w-8 h-8 grid place-items-center rounded-[var(--radius-sm)] text-[var(--neutral-500)] hover:text-[var(--neutral-900)] hover:bg-[var(--neutral-100)] cursor-pointer"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="w-4 h-4">
          <circle cx="4.5" cy="10" r="1.6" />
          <circle cx="10" cy="10" r="1.6" />
          <circle cx="15.5" cy="10" r="1.6" />
        </svg>
      </button>
      {menuOpen ? (
        <div
          role="menu"
          className="absolute right-0 top-9 z-20 min-w-[170px] py-1 bg-white border border-[var(--neutral-200)] rounded-[var(--radius-sm)] shadow-[0_8px_24px_rgba(24,24,27,0.12)]"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              setError(null);
              setConfirmOpen(true);
            }}
            className="w-full text-left px-3.5 py-2 text-sm text-[var(--error-text)] hover:bg-[var(--error-bg)] cursor-pointer"
          >
            Delete project
          </button>
        </div>
      ) : null}

      <ModalCard
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        eyebrow="Delete project"
        title="Delete this project?"
        maxWidthClassName="max-w-[440px]"
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              loading={deleting}
              loadingLabel="Deleting..."
              onClick={remove}
              className="!bg-[var(--error-text)] hover:!opacity-90"
            >
              Delete permanently
            </Button>
          </>
        }
      >
        <p className="text-sm text-[var(--neutral-700)] leading-relaxed">
          <strong className="font-semibold text-[var(--neutral-900)] [overflow-wrap:anywhere]">
            {projectTitle}
          </strong>{" "}
          and all of its chapters, sources, uploaded data and exported files will be deleted. This
          cannot be undone. Credits already used are not refunded.
        </p>
        {error ? <FormAlert tone="error">{error}</FormAlert> : null}
      </ModalCard>
    </div>
  );
}
