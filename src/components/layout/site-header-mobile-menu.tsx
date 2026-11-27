"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { CloseIcon, MenuIcon } from "@/components/layout/workspace-icons";

const PUBLIC_SECTION_LINKS = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#what-you-get", label: "What you get" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" },
] as const;

const ACCOUNT_MENU_LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/projects", label: "Projects" },
  { href: "/exports", label: "Exports" },
  { href: "/billing", label: "Credits & Billing" },
  { href: "/account", label: "Account" },
] as const;

export function SiteHeaderMobileMenu({ signedIn }: { signedIn: boolean }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        aria-controls="site-header-mobile-panel"
        className="min-w-[44px] min-h-[44px] rounded-[var(--radius-sm)] text-[var(--neutral-700)] hover:bg-[var(--neutral-100)] hover:text-[var(--neutral-900)] grid place-items-center transition-colors cursor-pointer"
      >
        {open ? <CloseIcon className="w-5 h-5" /> : <MenuIcon className="w-5 h-5" />}
      </button>

      {open ? (
        <div
          id="site-header-mobile-panel"
          className="absolute left-0 right-0 top-full z-40 border-b border-[var(--neutral-200)] bg-white shadow-[var(--shadow-raised)]"
        >
          <nav
            aria-label={signedIn ? "Mobile account navigation" : "Mobile navigation"}
            className="mx-auto w-full max-w-[1380px] 2xl:max-w-[1520px] px-4 sm:px-6 py-3 flex flex-col gap-1"
          >
            {signedIn ? (
              <>
                {ACCOUNT_MENU_LINKS.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className="min-h-[44px] px-3 rounded-[var(--radius-sm)] inline-flex items-center text-sm font-medium text-[var(--neutral-800)] hover:bg-[var(--neutral-100)] hover:text-[var(--neutral-900)]"
                  >
                    {item.label}
                  </Link>
                ))}
                <div className="pt-2 mt-1 border-t border-[var(--neutral-200)]">
                  <SignOutButton variant="ghost" />
                </div>
              </>
            ) : (
              <>
                {PUBLIC_SECTION_LINKS.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className="min-h-[44px] px-3 rounded-[var(--radius-sm)] inline-flex items-center text-sm font-medium text-[var(--neutral-800)] hover:bg-[var(--neutral-100)] hover:text-[var(--neutral-900)]"
                  >
                    {item.label}
                  </Link>
                ))}
                <div className="pt-2 mt-1 border-t border-[var(--neutral-200)] flex flex-col gap-1">
                  <Link
                    href="/sign-in"
                    onClick={() => setOpen(false)}
                    className="min-h-[44px] px-3 rounded-[var(--radius-sm)] inline-flex items-center text-sm font-medium text-[var(--accent-600)] hover:bg-[var(--neutral-100)]"
                  >
                    Sign in
                  </Link>
                </div>
              </>
            )}
          </nav>
        </div>
      ) : null}
    </div>
  );
}
