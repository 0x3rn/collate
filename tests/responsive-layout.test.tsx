import type { AnchorHTMLAttributes, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AppShell } from "@/components/layout/app-shell";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { LegalDocumentView } from "@/components/legal/legal-document";
import { DeliverablesBento } from "@/components/marketing/deliverables-bento";
import { PricingShowcase } from "@/components/marketing/pricing-showcase";
import { getPublicPricingSummary } from "@/lib/marketing/landing-content";
import { COOKIE_POLICY } from "@/lib/legal/cookie-policy";
import { TERMS_POLICY } from "@/lib/legal/terms-policy";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

describe("Responsive layout contracts across public, legal, and workspace shells", () => {
  it("aligns SiteHeader, SiteFooter, and LegalDocumentView on the same wide desktop container scale", () => {
    const expectedContainer = "max-w-[1380px] 2xl:max-w-[1520px]";
    const headerHtml = renderToStaticMarkup(<SiteHeader user={null} />);
    const footerHtml = renderToStaticMarkup(<SiteFooter />);
    const legalHtml = renderToStaticMarkup(
      <LegalDocumentView document={TERMS_POLICY} user={null} />
    );

    expect(headerHtml).toContain(expectedContainer);
    expect(footerHtml).toContain(expectedContainer);
    expect(legalHtml).toContain(expectedContainer);
  });

  it("provides mobile menu controls in SiteHeader for both signed-out and signed-in users without inline mobile overflow", () => {
    const signedOutHtml = renderToStaticMarkup(<SiteHeader user={null} />);
    expect(signedOutHtml).toContain('aria-label="Open menu"');
    expect(signedOutHtml).toContain("Create account");
    expect(signedOutHtml).toContain('href="/sign-in"');

    const signedInHtml = renderToStaticMarkup(
      <SiteHeader
        user={{
          id: "usr_1",
          email: "student@uni.edu",
          emailVerified: true,
          name: "Adaeze Okonkwo",
          creditsBalance: 100,
          createdAt: new Date("2026-11-01T00:00:00Z"),
        }}
      />
    );
    expect(signedInHtml).toContain('aria-label="Open menu"');
    expect(signedInHtml).toContain('aria-label="Account navigation" class="hidden md:flex');
  });

  it("renders mobile stacked cards alongside desktop tables for wide legal policy tables", () => {
    const termsHtml = renderToStaticMarkup(
      <LegalDocumentView document={TERMS_POLICY} user={null} />
    );
    const cookiesHtml = renderToStaticMarkup(
      <LegalDocumentView document={COOKIE_POLICY} user={null} />
    );

    expect(termsHtml).toContain("md:hidden space-y-2.5");
    expect(termsHtml).toContain("hidden md:block overflow-x-auto");
    expect(cookiesHtml).toContain("md:hidden space-y-2.5");
    expect(cookiesHtml).toContain("hidden md:block overflow-x-auto");
  });

  it("renders DeliverablesBento with inline mobile accordion and matched-height desktop stage, and PricingShowcase without cramped md 3-col cards", () => {
    const bentoHtml = renderToStaticMarkup(<DeliverablesBento />);
    expect(bentoHtml).toContain("lg:hidden space-y-3");
    expect(bentoHtml).toContain("hidden lg:grid lg:grid-cols-12");
    expect(bentoHtml).toContain("lg:items-stretch");
    expect(bentoHtml).toContain("Built-in check:");

    const pricingHtml = renderToStaticMarkup(
      <PricingShowcase packs={getPublicPricingSummary().packs} signedIn={false} />
    );
    expect(pricingHtml).toContain("grid-cols-1 lg:grid-cols-3");
    expect(pricingHtml).toContain("whitespace-nowrap");
  });

  it("uses a wide 1440px default container in AppShell to avoid large sidebar gaps on 1600px+ screens", () => {
    const shellHtml = renderToStaticMarkup(
      <AppShell
        user={{
          name: "Adaeze Okonkwo",
          email: "adaeze@uni.edu",
          creditsBalance: 80,
        }}
      >
        <div>Content</div>
      </AppShell>
    );
    expect(shellHtml).toContain("max-w-[1440px]");
  });
});
