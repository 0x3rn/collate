import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-[var(--neutral-200)] bg-white">
      <div className="mx-auto max-w-[1120px] px-4 sm:px-6 py-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-sm text-[var(--neutral-600)]">
        <p className="m-0">
          <span className="font-semibold text-[var(--neutral-900)]">Collate</span> — Research and
          drafting assistant for evidence-backed academic writing.
        </p>
        <nav aria-label="Footer navigation" className="flex flex-wrap items-center gap-5">
          <Link
            href="/terms"
            className="hover:text-[var(--neutral-900)] underline-offset-4 hover:underline"
          >
            Terms of service
          </Link>
          <Link
            href="/privacy"
            className="hover:text-[var(--neutral-900)] underline-offset-4 hover:underline"
          >
            Privacy policy
          </Link>
          <Link
            href="/sign-in"
            className="hover:text-[var(--neutral-900)] underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </nav>
      </div>
    </footer>
  );
}
