import Link from "next/link";
import { CollateLogo } from "@/components/brand/collate-logo";
import { CookiePreferencesTrigger } from "@/components/privacy/cookie-consent-analytics";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-[var(--neutral-200)] bg-white">
      <div className="mx-auto w-full max-w-[1380px] 2xl:max-w-[1520px] px-4 sm:px-6 lg:px-8 xl:px-10 py-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-8 lg:gap-10 text-sm">
        <div className="sm:col-span-2 space-y-2.5">
          <div className="inline-flex items-center gap-2">
            <CollateLogo className="w-5 h-5 text-[var(--accent-600)] shrink-0" />
            <p
              className="text-lg font-semibold leading-none translate-y-[0.5px] text-[var(--neutral-900)]"
              style={{ fontFamily: "var(--font-serif)" }}
            >
              Collate
            </p>
          </div>
          <p className="text-[var(--neutral-600)] max-w-[46ch] leading-relaxed">
            Research and drafting assistant for evidence-backed projects, research papers, theses,
            and assignments.
          </p>
        </div>

        <div className="space-y-2.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--neutral-500)]">
            Product
          </p>
          <nav
            aria-label="Product links"
            className="flex flex-col gap-0.5 sm:gap-2 text-[var(--neutral-700)]"
          >
            <Link
              href="/#work-types"
              className="inline-flex items-center min-h-[40px] sm:min-h-0 hover:text-[var(--neutral-900)] hover:underline underline-offset-4 w-fit"
            >
              Work types
            </Link>
            <Link
              href="/#how-it-works"
              className="inline-flex items-center min-h-[40px] sm:min-h-0 hover:text-[var(--neutral-900)] hover:underline underline-offset-4 w-fit"
            >
              How it works
            </Link>
            <Link
              href="/#what-you-get"
              className="inline-flex items-center min-h-[40px] sm:min-h-0 hover:text-[var(--neutral-900)] hover:underline underline-offset-4 w-fit"
            >
              What you get
            </Link>
            <Link
              href="/#pricing"
              className="inline-flex items-center min-h-[40px] sm:min-h-0 hover:text-[var(--neutral-900)] hover:underline underline-offset-4 w-fit"
            >
              Pricing
            </Link>
            <Link
              href="/#faq"
              className="inline-flex items-center min-h-[40px] sm:min-h-0 hover:text-[var(--neutral-900)] hover:underline underline-offset-4 w-fit"
            >
              FAQ
            </Link>
          </nav>
        </div>

        <div className="space-y-2.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--neutral-500)]">
            Legal
          </p>
          <nav
            aria-label="Legal links"
            className="flex flex-col gap-0.5 sm:gap-2 text-[var(--neutral-700)]"
          >
            <Link
              href="/terms"
              className="inline-flex items-center min-h-[40px] sm:min-h-0 hover:text-[var(--neutral-900)] hover:underline underline-offset-4 w-fit"
            >
              Terms of service
            </Link>
            <Link
              href="/terms#refund-policy"
              className="inline-flex items-center min-h-[40px] sm:min-h-0 hover:text-[var(--neutral-900)] hover:underline underline-offset-4 w-fit"
            >
              Refund policy
            </Link>
            <Link
              href="/privacy"
              className="inline-flex items-center min-h-[40px] sm:min-h-0 hover:text-[var(--neutral-900)] hover:underline underline-offset-4 w-fit"
            >
              Privacy policy
            </Link>
            <Link
              href="/acceptable-use"
              className="inline-flex items-center min-h-[40px] sm:min-h-0 hover:text-[var(--neutral-900)] hover:underline underline-offset-4 w-fit"
            >
              Acceptable use
            </Link>
            <Link
              href="/cookies"
              className="inline-flex items-center min-h-[40px] sm:min-h-0 hover:text-[var(--neutral-900)] hover:underline underline-offset-4 w-fit"
            >
              Cookie policy
            </Link>
            <CookiePreferencesTrigger className="inline-flex items-center min-h-[40px] sm:min-h-0 w-fit" />
          </nav>
        </div>

        <div className="space-y-2.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--neutral-500)]">
            Account
          </p>
          <nav
            aria-label="Account links"
            className="flex flex-col gap-0.5 sm:gap-2 text-[var(--neutral-700)]"
          >
            <Link
              href="/sign-up"
              className="inline-flex items-center min-h-[40px] sm:min-h-0 hover:text-[var(--neutral-900)] hover:underline underline-offset-4 w-fit"
            >
              Create account
            </Link>
            <Link
              href="/sign-in"
              className="inline-flex items-center min-h-[40px] sm:min-h-0 hover:text-[var(--neutral-900)] hover:underline underline-offset-4 w-fit"
            >
              Sign in
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
