import type { AnchorHTMLAttributes, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LegalDocumentView } from "@/components/legal/legal-document";
import { SiteFooter } from "@/components/layout/site-footer";
import { ACCEPTABLE_USE_POLICY } from "@/lib/legal/acceptable-use-policy";
import { COOKIE_POLICY } from "@/lib/legal/cookie-policy";
import { PRIVACY_POLICY } from "@/lib/legal/privacy-policy";
import { TERMS_POLICY } from "@/lib/legal/terms-policy";
import type { LegalDocumentData } from "@/lib/legal/types";

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
  usePathname: () => "/terms",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

const ALL_POLICIES: readonly LegalDocumentData[] = [
  TERMS_POLICY,
  PRIVACY_POLICY,
  ACCEPTABLE_USE_POLICY,
  COOKIE_POLICY,
];

describe("Legal policy documents, refund rules, and Polar.sh compliance", () => {
  it("renders all 4 extensive policies cleanly with unique section anchors, zero em-dashes, and zero unfinished placeholders", () => {
    for (const doc of ALL_POLICIES) {
      const ids = doc.sections.map((s) => s.id);
      expect(new Set(ids).size, `Duplicate section id in ${doc.slug}`).toBe(ids.length);
      expect(doc.sections.length, `Too few sections in ${doc.slug}`).toBeGreaterThanOrEqual(8);

      const html = renderToStaticMarkup(<LegalDocumentView document={doc} user={null} />);
      expect(html).toContain(doc.title.replace(/&/g, "&amp;"));
      expect(html).not.toContain("\u2014");
      expect(html).not.toMatch(/\[CONFIRM|\[Company|\[Data Controller|\[Month Day|\[Registered/i);

      for (const section of doc.sections) {
        expect(html).toContain(`id="${section.id}"`);
        expect(html).toContain(`href="#${section.id}"`);
      }
    }
  });

  it("encodes exact Collate refund eligibility rules and Polar.sh Merchant of Record terms in /terms", () => {
    const html = renderToStaticMarkup(<LegalDocumentView document={TERMS_POLICY} user={null} />);
    expect(html).toContain('id="refund-policy"');
    // Polar is named once, as the reseller its terms require us to disclose; nothing else is.
    expect(html).toContain("Polar Software, Inc.");
    expect(html).toContain("Merchant of Record");
    expect(html).not.toMatch(/Paystack|Polar.sh/);
    expect(html).toContain("payment provider");
    expect(html).toContain("unable to work on or support your research topic");
    expect(html).toContain("full cash refund");
    expect(html).toContain("no chapters have been made or delivered");
    expect(html).toContain("after one or more chapters have already been made and delivered");
    expect(html).toContain("partial cash refund");
    expect(html).toContain("automatically refunded in full to your Collate credit balance");
  });

  it("accurately reflects Collate's privacy stack, AUP restrictions, cookie inventory, and footer links", () => {
    const privacyHtml = renderToStaticMarkup(
      <LegalDocumentView document={PRIVACY_POLICY} user={null} />
    );
    expect(privacyHtml).toContain("NDPA 2023");
    expect(privacyHtml).toContain("GDPR");
    expect(privacyHtml).toContain("CCPA/CPRA");
    expect(privacyHtml).toContain("Polar Software, Inc. (Polar.sh)");
    expect(privacyHtml).toContain("DELETE MY ACCOUNT");
    expect(privacyHtml).toContain("never used to train");
    expect(privacyHtml).not.toContain("Vectorize");

    const aupHtml = renderToStaticMarkup(
      <LegalDocumentView document={ACCEPTABLE_USE_POLICY} user={null} />
    );
    expect(aupHtml).toContain("Contract Cheating and Essay Mills");
    expect(aupHtml).toContain("Empirical Data Fabrication");
    expect(aupHtml).toContain("CSAM");
    expect(aupHtml).not.toMatch(/Polar|Paystack|Cloudflare/);
    expect(aupHtml).toContain("payment provider");

    const cookieHtml = renderToStaticMarkup(
      <LegalDocumentView document={COOKIE_POLICY} user={null} />
    );
    expect(cookieHtml).toContain("__Host-collate_session");
    expect(cookieHtml).toContain("__cf_bm");
    expect(cookieHtml).toContain("Zero Advertising Cookies and Opt-In Analytics Only");
    expect(cookieHtml).toContain("Google Analytics 4");
    expect(cookieHtml).toContain("7 days");
    expect(cookieHtml).not.toMatch(/Polar|Paystack/);
    expect(cookieHtml).toContain("payment provider");

    const footerHtml = renderToStaticMarkup(<SiteFooter />);
    expect(footerHtml).toContain('href="/terms"');
    expect(footerHtml).toContain('href="/terms#refund-policy"');
    expect(footerHtml).toContain('href="/privacy"');
    expect(footerHtml).toContain('href="/acceptable-use"');
    expect(footerHtml).toContain('href="/cookies"');
    expect(footerHtml).toContain("Cookie preferences");
    expect(footerHtml).not.toMatch(/cloudflare/i);
  });
});
