import type { AnchorHTMLAttributes, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CreditsPanel } from "@/components/account/credits-panel";
import { DeleteAccountPanel } from "@/components/account/delete-account-panel";
import { NotificationPrefsForm } from "@/components/account/notification-prefs-form";
import { ExportsLibraryClient } from "@/components/dashboard/exports-library-client";
import { ProjectCard } from "@/components/dashboard/project-card";
import { ProjectsDirectoryClient } from "@/components/dashboard/projects-directory-client";
import { AppShell } from "@/components/layout/app-shell";
import type { DashboardProjectSummary, UserExportItem } from "@/db/queries/dashboard";

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
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

const SAMPLE_PROJECT: DashboardProjectSummary = {
  id: "prj_001",
  type: "thesis",
  title: "Solar Microgrid Reliability in Rural Clinics",
  level: "Masters",
  field: "Energy Engineering",
  institution: "University of Lagos",
  status: "in_progress",
  lifecycleTab: "active",
  wizardStep: 8,
  targetPages: 80,
  idealPages: 80,
  citationStyle: "apa7",
  chaptersTotal: 5,
  chaptersReady: 1,
  chaptersApproved: 2,
  chaptersWriting: 0,
  chaptersNeedsAttention: 0,
  sourcesCount: 38,
  exportsCount: 2,
  nextAction: {
    href: "/projects/prj_001/chapters/ch_3",
    label: "Review Chapter 3",
  },
  createdAt: "2026-11-20T10:00:00.000Z",
  updatedAt: "2026-11-23T12:00:00.000Z",
};

const SAMPLE_EXPORT: UserExportItem = {
  id: "exp_001",
  projectId: "prj_001",
  projectTitle: "Solar Microgrid Reliability in Rural Clinics",
  projectType: "thesis",
  chapterId: null,
  chapterNumber: null,
  chapterTitle: null,
  scope: "full",
  format: "pdf",
  pageCount: 82,
  sizeBytes: 1_450_000,
  createdAt: "2026-11-23T15:00:00.000Z",
  downloadUrl: "/api/projects/prj_001/exports/exp_001/download?exp=9999999999&sig=test",
};

describe("Workspace AppShell, dashboard routes, and plain-language account UI", () => {
  it("renders AppShell with all 5 grouped navigation links and zero public marketing footer", () => {
    const html = renderToStaticMarkup(
      <AppShell
        user={{
          name: "Adaeze Okonkwo",
          email: "adaeze@uni.edu",
          creditsBalance: 80,
          isAdmin: false,
        }}
      >
        <h1>Workspace content</h1>
      </AppShell>
    );

    expect(html).toContain('href="/dashboard"');
    expect(html).toContain('href="/projects"');
    expect(html).toContain('href="/exports"');
    expect(html).toContain('href="/billing"');
    expect(html).toContain('href="/account"');
    expect(html).toContain('href="/projects/new"');
    expect(html).toContain("80 credits");
    expect(html).toContain("Adaeze Okonkwo");
    expect(html).not.toContain("<footer");
    expect(html).not.toContain("Create account");
    expect(html).not.toContain('href="/admin"');

    const adminHtml = renderToStaticMarkup(
      <AppShell
        user={{
          name: "Admin User",
          email: "admin@collate.app",
          creditsBalance: 100,
          isAdmin: true,
        }}
      >
        <p>Admin</p>
      </AppShell>
    );
    expect(adminHtml).toContain('href="/admin"');
  });

  it("renders warm-paper empty-state artwork for Projects and Exports when empty", () => {
    const emptyProjectsHtml = renderToStaticMarkup(<ProjectsDirectoryClient projects={[]} />);
    expect(emptyProjectsHtml).toContain('src="/images/empty-projects.jpg"');
    expect(emptyProjectsHtml).toContain('width="800"');
    expect(emptyProjectsHtml).toContain("No projects yet");

    const emptyExportsHtml = renderToStaticMarkup(<ExportsLibraryClient exportsList={[]} />);
    expect(emptyExportsHtml).toContain('src="/images/empty-exports.jpg"');
    expect(emptyExportsHtml).toContain('width="800"');
    expect(emptyExportsHtml).toContain("No exported files yet");
  });

  it("renders ProjectsDirectoryClient tabs, ProjectCard progress, and ExportsLibraryClient downloads", () => {
    const dirHtml = renderToStaticMarkup(<ProjectsDirectoryClient projects={[SAMPLE_PROJECT]} />);
    expect(dirHtml).toContain("Active");
    expect(dirHtml).toContain("Completed");
    expect(dirHtml).toContain("Archived");
    expect(dirHtml).toContain("Solar Microgrid Reliability in Rural Clinics");
    expect(dirHtml).toContain("3 of 5 chapters drafted");
    expect(dirHtml).toContain("60%");
    expect(dirHtml).toContain("Review Chapter 3");

    const cardHtml = renderToStaticMarkup(<ProjectCard project={SAMPLE_PROJECT} />);
    expect(cardHtml).toContain("APA 7");
    expect(cardHtml).toContain("38 sources");

    const exportsHtml = renderToStaticMarkup(
      <ExportsLibraryClient exportsList={[SAMPLE_EXPORT]} />
    );
    expect(exportsHtml).toContain("Full manuscript");
    expect(exportsHtml).toContain("82 pages");
    expect(exportsHtml).toContain("1.4 MB");
    expect(exportsHtml).toContain(
      'href="/api/projects/prj_001/exports/exp_001/download?exp=9999999999&amp;sig=test"'
    );
  });

  it("renders plain-language billing and account panels without developer jargon", () => {
    const billingHtml = renderToStaticMarkup(
      <CreditsPanel
        balance={80}
        recentLedger={[
          {
            id: "led_1",
            entryType: "sweep_fee",
            creditsDelta: -2,
            balanceAfter: 80,
            note: "Extra topic check",
            createdAt: "2026-11-23T12:00:00.000Z",
          },
        ]}
      />
    );
    expect(billingHtml).toContain("Credit history");
    expect(billingHtml).toContain("Topic source check");
    expect(billingHtml).not.toContain("Recent ledger");
    expect(billingHtml).not.toContain("sweep_fee");

    const prefsHtml = renderToStaticMarkup(
      <NotificationPrefsForm
        initialPrefs={{
          emailChapterReady: true,
          emailNeedsAttention: true,
          emailProjectComplete: true,
          emailReceipts: true,
        }}
      />
    );
    expect(prefsHtml).toContain("Email updates");
    expect(prefsHtml).not.toContain("originality checks, timeouts, or errors");

    const deleteHtml = renderToStaticMarkup(<DeleteAccountPanel />);
    expect(deleteHtml).toContain("Delete account");
    expect(deleteHtml).not.toContain("NDPA");
    expect(deleteHtml).not.toContain("GDPR");
  });
});
