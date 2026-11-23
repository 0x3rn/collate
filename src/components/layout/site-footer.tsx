import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-[var(--neutral-200)] bg-white">
      <div className="mx-auto max-w-[1120px] px-4 sm:px-6 py-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 text-sm">
        <div className="sm:col-span-2 space-y-2">
          <p
            className="text-lg font-semibold text-[var(--neutral-900)] m-0"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            Collate
          </p>
          <p className="text-[var(--neutral-600)] max-w-[46ch] leading-relaxed m-0">
            Research and drafting assistant for evidence-backed projects, research papers, theses,
            and assignments. Built on Cloudflare Workers.
          </p>
        </div>

        <div className="space-y-2.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--neutral-500)] m-0">
            Product
          </p>
          <nav aria-label="Product links" className="flex flex-col gap-2 text-[var(--neutral-700)]">
            <Link
              href="/#work-types"
              className="hover:text-[var(--neutral-900)] hover:underline underline-offset-4"
            >
              Work types
            </Link>
            <Link
              href="/#how-it-works"
              className="hover:text-[var(--neutral-900)] hover:underline underline-offset-4"
            >
              How it works
            </Link>
            <Link
              href="/#what-you-get"
              className="hover:text-[var(--neutral-900)] hover:underline underline-offset-4"
            >
              What you get
            </Link>
            <Link
              href="/#pricing"
              className="hover:text-[var(--neutral-900)] hover:underline underline-offset-4"
            >
              Pricing
            </Link>
            <Link
              href="/#faq"
              className="hover:text-[var(--neutral-900)] hover:underline underline-offset-4"
            >
              FAQ
            </Link>
          </nav>
        </div>

        <div className="space-y-2.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--neutral-500)] m-0">
            Account &amp; legal
          </p>
          <nav
            aria-label="Legal and account links"
            className="flex flex-col gap-2 text-[var(--neutral-700)]"
          >
            <Link
              href="/sign-up"
              className="hover:text-[var(--neutral-900)] hover:underline underline-offset-4"
            >
              Create account
            </Link>
            <Link
              href="/sign-in"
              className="hover:text-[var(--neutral-900)] hover:underline underline-offset-4"
            >
              Sign in
            </Link>
            <Link
              href="/terms"
              className="hover:text-[var(--neutral-900)] hover:underline underline-offset-4"
            >
              Terms of service
            </Link>
            <Link
              href="/privacy"
              className="hover:text-[var(--neutral-900)] hover:underline underline-offset-4"
            >
              Privacy policy
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
