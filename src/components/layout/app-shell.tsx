"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ComponentType, type ReactNode, type SVGProps } from "react";
import { CollateLogo } from "@/components/brand/collate-logo";
import { SpinnerIcon } from "@/components/ui/button";
import { formatCredits, getUserInitials } from "@/lib/ui/formatters";
import { startRouteProgress } from "@/lib/ui/route-progress";
import {
  BillingIcon,
  CloseIcon,
  ExportsIcon,
  LogOutIcon,
  MenuIcon,
  OverviewIcon,
  PlusIcon,
  ProjectsIcon,
  SettingsIcon,
  ShieldIcon,
} from "./workspace-icons";

export interface AppShellUser {
  name: string;
  email: string;
  creditsBalance: number;
  isAdmin?: boolean;
}

interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  match: (pathname: string) => boolean;
}

const RESEARCH_NAV: readonly NavItem[] = [
  {
    href: "/dashboard",
    label: "Overview",
    icon: OverviewIcon,
    match: (p) => p === "/dashboard",
  },
  {
    href: "/projects",
    label: "Projects",
    icon: ProjectsIcon,
    match: (p) => p === "/projects" || p.startsWith("/projects/"),
  },
  {
    href: "/exports",
    label: "Exports",
    icon: ExportsIcon,
    match: (p) => p === "/exports",
  },
];

const ACCOUNT_NAV: readonly NavItem[] = [
  {
    href: "/billing",
    label: "Credits & Billing",
    icon: BillingIcon,
    match: (p) => p === "/billing",
  },
  {
    href: "/account",
    label: "Account",
    icon: SettingsIcon,
    match: (p) => p === "/account",
  },
];

function SidebarContent({
  user,
  pathname,
  onNavigate,
  onSignOut,
  signingOut,
}: {
  user: AppShellUser;
  pathname: string;
  onNavigate?: () => void;
  onSignOut: () => void;
  signingOut: boolean;
}) {
  const initials = getUserInitials(user.name);

  function renderNavGroup(heading: string, items: readonly NavItem[]) {
    return (
      <div className="space-y-1">
        <p className="px-2.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--neutral-400)]">
          {heading}
        </p>
        <ul className="space-y-0.5 list-none p-0">
          {items.map((item) => {
            const active = item.match(pathname);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={`relative min-h-[38px] px-2.5 py-2 rounded-[var(--radius-sm)] flex items-center gap-2.5 text-sm transition-colors duration-150 ${
                    active
                      ? "bg-[var(--accent-100)] text-[var(--accent-600)] font-semibold"
                      : "text-[var(--neutral-700)] font-medium hover:bg-[var(--neutral-100)] hover:text-[var(--neutral-900)]"
                  }`}
                >
                  <Icon
                    className={`w-[17px] h-[17px] shrink-0 transition-colors ${
                      active ? "text-[var(--accent-600)]" : "text-[var(--neutral-500)]"
                    }`}
                  />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Brand header — standalone SVG emblem + live wordmark */}
      <div className="h-15 px-5 border-b border-[var(--neutral-200)] flex items-center justify-between gap-2 shrink-0">
        <Link
          href="/dashboard"
          onClick={onNavigate}
          className="inline-flex items-center gap-2 text-xl font-semibold tracking-tight leading-none text-[var(--neutral-900)]"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          <CollateLogo className="w-6 h-6 text-[var(--accent-600)] shrink-0" />
          <span className="leading-none translate-y-[0.5px]">Collate</span>
        </Link>
      </div>

      {/* Subtle new-project action */}
      <div className="px-3.5 pt-3.5 pb-1 shrink-0">
        <Link
          href="/projects/new"
          onClick={onNavigate}
          className="w-full min-h-[38px] px-3 py-1.5 rounded-[var(--radius-sm)] border border-[var(--neutral-300)] bg-[var(--neutral-50)] hover:bg-white hover:border-[var(--accent-600)] text-[var(--neutral-900)] text-sm font-medium inline-flex items-center justify-center gap-1.5 transition-all duration-150"
        >
          <PlusIcon className="w-4 h-4 text-[var(--accent-600)] shrink-0" />
          <span>New project</span>
        </Link>
      </div>

      {/* Grouped main navigation */}
      <nav aria-label="Main navigation" className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        {renderNavGroup("Research", RESEARCH_NAV)}
        {renderNavGroup("Account", ACCOUNT_NAV)}
        {user.isAdmin
          ? renderNavGroup("Operations", [
              {
                href: "/admin",
                label: "Admin",
                icon: ShieldIcon,
                match: (p) => p === "/admin",
              },
            ])
          : null}
      </nav>

      {/* Bottom credits & user utility bar */}
      <div className="p-3.5 border-t border-[var(--neutral-200)] bg-[var(--neutral-50)]/70 space-y-3 shrink-0">
        <Link
          href="/billing"
          onClick={onNavigate}
          className="block px-3 py-2.5 rounded-[var(--radius-sm)] bg-white border border-[var(--neutral-200)] hover:border-[var(--neutral-300)] transition-colors group space-y-1"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-medium text-[var(--neutral-500)] leading-tight">
              Available credits
            </p>
            <span className="text-[11px] font-semibold text-[var(--accent-600)] group-hover:underline underline-offset-4 shrink-0">
              Top up
            </span>
          </div>
          <p
            title={formatCredits(user.creditsBalance)}
            className="text-sm font-semibold text-[var(--neutral-900)] tabular-nums truncate"
          >
            {formatCredits(user.creditsBalance)}
          </p>
        </Link>

        <div className="flex items-center justify-between gap-2 px-0.5">
          <Link
            href="/account"
            onClick={onNavigate}
            className="flex items-center gap-2.5 min-w-0 group"
          >
            <span
              aria-hidden="true"
              className="w-8 h-8 rounded-full bg-[var(--accent-100)] text-[var(--accent-600)] border border-[var(--neutral-200)] text-xs font-semibold grid place-items-center shrink-0"
            >
              {initials}
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-[var(--neutral-900)] truncate group-hover:text-[var(--accent-600)] transition-colors">
                {user.name}
              </p>
              <p className="text-[11px] text-[var(--neutral-500)] truncate">{user.email}</p>
            </div>
          </Link>

          <button
            type="button"
            onClick={onSignOut}
            disabled={signingOut}
            title="Sign out"
            aria-label="Sign out"
            className="w-9 h-9 rounded-[var(--radius-sm)] text-[var(--neutral-500)] hover:text-[var(--neutral-900)] hover:bg-[var(--neutral-200)]/60 grid place-items-center shrink-0 transition-colors cursor-pointer disabled:opacity-50"
          >
            {signingOut ? <SpinnerIcon className="w-4 h-4" /> : <LogOutIcon className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AppShell({
  user,
  children,
  maxWidthClassName = "max-w-[1440px]",
}: {
  user: AppShellUser;
  children: ReactNode;
  maxWidthClassName?: string;
}) {
  const pathname = usePathname() || "/dashboard";
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen]);

  function handleNavigate() {
    setMobileOpen(false);
  }

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await fetch("/api/auth/signout", { method: "POST" });
    } finally {
      startRouteProgress();
      router.push("/sign-in");
      router.refresh();
    }
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-[var(--neutral-50)]">
      {/* Desktop persistent left sidebar */}
      <aside className="hidden lg:block print:!hidden lg:w-[244px] lg:shrink-0 border-r border-[var(--neutral-200)] bg-white">
        <div className="sticky top-0 h-screen">
          <SidebarContent
            user={user}
            pathname={pathname}
            onNavigate={handleNavigate}
            onSignOut={handleSignOut}
            signingOut={signingOut}
          />
        </div>
      </aside>

      {/* Mobile compact sticky header */}
      <header className="lg:hidden print:hidden sticky top-0 z-30 h-14 px-3 sm:px-4 bg-white border-b border-[var(--neutral-200)] flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation menu"
            aria-expanded={mobileOpen}
            className="min-w-[44px] min-h-[44px] -ml-1 rounded-[var(--radius-sm)] text-[var(--neutral-700)] hover:bg-[var(--neutral-100)] grid place-items-center shrink-0 cursor-pointer"
          >
            <MenuIcon className="w-5 h-5" />
          </button>

          <Link
            href="/dashboard"
            onClick={handleNavigate}
            className="inline-flex items-center gap-1.5 h-9 text-lg font-semibold tracking-tight leading-none text-[var(--neutral-900)]"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            <CollateLogo className="w-[22px] h-[22px] text-[var(--accent-600)] shrink-0" />
            <span className="leading-none translate-y-[0.5px]">Collate</span>
          </Link>
        </div>

        <Link
          href="/projects/new"
          onClick={handleNavigate}
          className="min-h-[40px] px-3 rounded-[var(--radius-sm)] bg-[var(--accent-600)] hover:bg-[var(--accent-700)] text-white text-xs font-medium inline-flex items-center gap-1 shrink-0 transition-colors"
        >
          <PlusIcon className="w-3.5 h-3.5" />
          <span>New project</span>
        </Link>
      </header>

      {/* Mobile slide-over navigation drawer */}
      {mobileOpen ? (
        <div
          className="lg:hidden fixed inset-0 z-50 flex"
          role="dialog"
          aria-modal="true"
          aria-label="Main navigation"
        >
          <div
            className="fixed inset-0 bg-[var(--neutral-900)]/35"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative z-10 w-[276px] max-w-[85vw] bg-white h-full border-r border-[var(--neutral-200)] shadow-[var(--shadow-raised)] flex flex-col">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation menu"
              className="absolute top-2.5 right-2.5 min-w-[44px] min-h-[44px] rounded-[var(--radius-sm)] text-[var(--neutral-600)] hover:bg-[var(--neutral-100)] grid place-items-center cursor-pointer z-20"
            >
              <CloseIcon className="w-5 h-5" />
            </button>
            <SidebarContent
              user={user}
              pathname={pathname}
              onNavigate={handleNavigate}
              onSignOut={handleSignOut}
              signingOut={signingOut}
            />
          </div>
        </div>
      ) : null}

      {/* Main page canvas — no public marketing footer */}
      <main className="flex-1 min-w-0">
        <div
          key={pathname}
          className={`page-enter mx-auto w-full ${maxWidthClassName} px-4 sm:px-6 lg:px-8 xl:px-10 py-6 sm:py-8`}
        >
          {children}
        </div>
      </main>
    </div>
  );
}
