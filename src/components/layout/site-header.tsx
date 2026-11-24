import Link from "next/link";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { CollateLogo } from "@/components/brand/collate-logo";
import { LinkButton } from "@/components/ui/button";
import type { PublicUser } from "@/lib/auth/service";

export function SiteHeader({ user }: { user: PublicUser | null }) {
  return (
    <header className="border-b border-[var(--neutral-200)] bg-white">
      <div className="mx-auto max-w-[1120px] px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        <Link
          href={user ? "/dashboard" : "/"}
          className="inline-flex items-center gap-2 text-xl font-semibold tracking-tight text-[var(--neutral-900)] shrink-0"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          <CollateLogo className="w-6 h-6 text-[var(--accent-600)] shrink-0" />
          <span className="leading-none translate-y-[0.5px]">Collate</span>
        </Link>

        {user ? (
          <nav aria-label="Account navigation" className="flex items-center gap-1 sm:gap-2">
            <Link
              href="/dashboard"
              className="min-h-[44px] px-3 inline-flex items-center text-sm font-medium text-[var(--neutral-700)] hover:text-[var(--neutral-900)] rounded-[var(--radius-sm)]"
            >
              Dashboard
            </Link>
            <Link
              href="/projects"
              className="min-h-[44px] px-3 inline-flex items-center text-sm font-medium text-[var(--neutral-700)] hover:text-[var(--neutral-900)] rounded-[var(--radius-sm)]"
            >
              Projects
            </Link>
            <Link
              href="/account"
              className="min-h-[44px] px-3 inline-flex items-center text-sm font-medium text-[var(--neutral-700)] hover:text-[var(--neutral-900)] rounded-[var(--radius-sm)]"
            >
              Account
            </Link>
            <SignOutButton variant="ghost" />
          </nav>
        ) : (
          <nav aria-label="Main navigation" className="flex items-center gap-1 sm:gap-3">
            <Link
              href="/#how-it-works"
              className="hidden md:inline-flex min-h-[44px] px-2.5 items-center text-sm font-medium text-[var(--neutral-700)] hover:text-[var(--neutral-900)]"
            >
              How it works
            </Link>
            <Link
              href="/#what-you-get"
              className="hidden md:inline-flex min-h-[44px] px-2.5 items-center text-sm font-medium text-[var(--neutral-700)] hover:text-[var(--neutral-900)]"
            >
              What you get
            </Link>
            <Link
              href="/#pricing"
              className="hidden md:inline-flex min-h-[44px] px-2.5 items-center text-sm font-medium text-[var(--neutral-700)] hover:text-[var(--neutral-900)]"
            >
              Pricing
            </Link>
            <Link
              href="/#faq"
              className="hidden md:inline-flex min-h-[44px] px-2.5 items-center text-sm font-medium text-[var(--neutral-700)] hover:text-[var(--neutral-900)]"
            >
              FAQ
            </Link>
            <Link
              href="/sign-in"
              className="min-h-[44px] px-3 inline-flex items-center text-sm font-medium text-[var(--neutral-700)] hover:text-[var(--neutral-900)]"
            >
              Sign in
            </Link>
            <LinkButton href="/sign-up" variant="primary" className="text-sm px-4">
              Create account
            </LinkButton>
          </nav>
        )}
      </div>
    </header>
  );
}
