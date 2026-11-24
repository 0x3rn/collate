import type { AnchorHTMLAttributes, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CreditsPanel } from "@/components/account/credits-panel";
import { DeleteAccountPanel } from "@/components/account/delete-account-panel";
import { NotificationPrefsForm } from "@/components/account/notification-prefs-form";
import { ExportsLibraryClient } from "@/components/dashboard/exports-library-client";
import { OverviewLedgerClient } from "@/components/dashboard/overview-ledger-client";
import { ProjectCard } from "@/components/dashboard/project-card";
import { ProjectsDirectoryClient } from "@/components/dashboard/projects-directory-client";
import { QuickStartWorkbench } from "@/components/dashboard/quick-start-workbench";
import { AppShell } from "@/components/layout/app-shell";
import { AutoHideScrollbar } from "@/components/layout/auto-hide-scrollbar";
import { ChapterPipelinePanel } from "@/components/project/chapter-pipeline-panel";
import { ChapterReaderClient } from "@/components/project/chapter-reader-client";
import { IntegrityPanel } from "@/components/project/integrity-panel";
import { Button } from "@/components/ui/button";
import { LedgerRowsSkeleton } from "@/components/ui/skeleton";
import type { DashboardProjectSummary, UserExportItem } from "@/db/queries/dashboard";
import { formatCredits, formatNumber } from "@/lib/ui/formatters";
import { computeScrollbarMetrics, computeScrollTopFromDrag } from "@/lib/ui/scrollbar";
import { buildOriginalityAttention, buildTechnicalErrorAttention } from "@/lib/writing/attention";

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
        <h1>Dashboard content</h1>
      </AppShell>
    );

    expect(html).toContain('href="/dashboard"');
    expect(html).toContain('href="/projects"');
    expect(html).toContain('href="/exports"');
    expect(html).toContain('href="/billing"');
    expect(html).toContain('href="/account"');
    expect(html).toContain('href="/projects/new"');
    expect(html).toContain("Research");
    expect(html).not.toMatch(/workspace/i);
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
    expect(prefsHtml).toContain("Chapter ready");
    expect(prefsHtml).toContain("Save email settings");
    expect(prefsHtml).not.toContain("originality checks, timeouts, or errors");

    const deleteHtml = renderToStaticMarkup(<DeleteAccountPanel />);
    expect(deleteHtml).toContain("Delete my account");
    expect(deleteHtml).not.toContain("NDPA");
    expect(deleteHtml).not.toContain("GDPR");
  });

  it("renders QuickStartWorkbench, OverviewLedgerClient, Button spinner, and shimmer skeletons", () => {
    const workbenchHtml = renderToStaticMarkup(<QuickStartWorkbench />);
    expect(workbenchHtml).toContain("Start a new project");
    expect(workbenchHtml).toContain("Research paper");
    expect(workbenchHtml).toContain("Thesis");
    expect(workbenchHtml).toContain("Assignment");
    expect(workbenchHtml).toContain("Start project");

    const overviewHtml = renderToStaticMarkup(
      <OverviewLedgerClient
        recentProjects={[SAMPLE_PROJECT]}
        totalProjects={1}
        attentionItems={[]}
        freeSweepsRemaining={3}
      />
    );
    expect(overviewHtml).toContain("Recent work");
    expect(overviewHtml).toContain("Needs review");
    expect(overviewHtml).toContain("Solar Microgrid Reliability in Rural Clinics");

    const loadingBtnHtml = renderToStaticMarkup(
      <Button loading loadingLabel="Creating draft...">
        Start project
      </Button>
    );
    expect(loadingBtnHtml).toContain("animate-spin");
    expect(loadingBtnHtml).toContain("Creating draft...");

    const skeletonHtml = renderToStaticMarkup(<LedgerRowsSkeleton rows={3} />);
    expect(skeletonHtml).toContain("skeleton-shimmer");
  });

  it("formats large credit balances with commas and removes jargon/JSON from project views", () => {
    expect(formatNumber(16_000_000)).toBe("16,000,000");
    expect(formatCredits(16_000_000)).toBe("16,000,000 credits");
    expect(formatCredits(1)).toBe("1 credit");

    const shellHtml = renderToStaticMarkup(
      <AppShell
        user={{
          name: "Somtochukwu Ike",
          email: "somto@uni.edu",
          creditsBalance: 16_000_000,
        }}
      >
        <p>Main</p>
      </AppShell>
    );
    expect(shellHtml).toContain("16,000,000 credits");
    expect(shellHtml).not.toContain("16,000,000 cr<");
    expect(shellHtml).not.toContain("16000000");

    const chaptersHtml = renderToStaticMarkup(
      <ChapterPipelinePanel
        projectId="prj_001"
        datasets={[]}
        chapters={[
          {
            id: "ch_1",
            number: 1,
            title: "Introduction",
            chapterType: "introduction",
            pageBudget: 7,
            wordBudget: 1925,
            isAutoReferences: false,
            status: "not_started",
            sectionHeadings: ["Background of the study"],
          },
          {
            id: "ch_4",
            number: 4,
            title: "Results",
            chapterType: "results",
            pageBudget: 12,
            wordBudget: 3300,
            isAutoReferences: false,
            status: "not_started",
            sectionHeadings: [],
          },
          {
            id: "ch_6",
            number: 6,
            title: "References",
            chapterType: "references",
            pageBudget: null,
            wordBudget: null,
            isAutoReferences: true,
            status: "not_started",
            sectionHeadings: [],
          },
        ]}
      />
    );
    expect(chaptersHtml).toContain("Chapter 1: Introduction");
    expect(chaptersHtml).toContain("Results data (optional)");
    expect(chaptersHtml).toContain("Chapters unlock one at a time");
    expect(chaptersHtml).toContain("Automatic");
    expect(chaptersHtml).not.toContain("Rule NN-");
    expect(chaptersHtml).not.toContain("Chapter N+1");
    expect(chaptersHtml).not.toContain("CSL");
    expect(chaptersHtml).not.toContain(">AUTO<");

    const integrityHtml = renderToStaticMarkup(
      <IntegrityPanel projectId="prj_001" disclosureStatement="Sample disclosure statement" />
    );
    expect(integrityHtml).toContain('href="/api/projects/prj_001/integrity?format=pdf"');
    expect(integrityHtml).toContain('href="/api/projects/prj_001/integrity?format=txt"');
    expect(integrityHtml).toContain('href="/api/projects/prj_001/integrity?format=md"');
    expect(integrityHtml).toContain("Writing log (.pdf)");
    expect(integrityHtml).toContain("Text (.txt)");
    expect(integrityHtml).toContain("Markdown (.md)");
    expect(integrityHtml).toContain(
      "Optional — only use if your institution requires an AI-use disclosure."
    );
    expect(integrityHtml).not.toContain("JSON");

    // Capitalized Chapter buttons, Resume Chapter vs Provide Details distinction, and clean reader recovery
    const attentionPipelineHtml = renderToStaticMarkup(
      <ChapterPipelinePanel
        projectId="prj_001"
        datasets={[]}
        chapters={[
          {
            id: "ch_tech",
            number: 1,
            title: "Introduction",
            chapterType: "introduction",
            pageBudget: 7,
            wordBudget: 1925,
            isAutoReferences: false,
            status: "needs_attention",
            sectionHeadings: ["Background"],
            attention: buildTechnicalErrorAttention(),
          },
          {
            id: "ch_input",
            number: 2,
            title: "Literature Review",
            chapterType: "literature_review",
            pageBudget: 12,
            wordBudget: 3300,
            isAutoReferences: false,
            status: "needs_attention",
            sectionHeadings: ["Themes"],
            attention: buildOriginalityAttention({ overlapScore: 17, quoteSharePct: 3 }),
          },
          {
            id: "ch_next",
            number: 3,
            title: "Methodology",
            chapterType: "methodology",
            pageBudget: 9,
            wordBudget: 2475,
            isAutoReferences: false,
            status: "not_started",
            sectionHeadings: [],
          },
        ]}
      />
    );
    expect(attentionPipelineHtml).toContain("Resume Chapter 1");
    expect(attentionPipelineHtml).toContain("Provide Details");
    expect(attentionPipelineHtml).toContain("Start Chapter 3");
    expect(attentionPipelineHtml).not.toContain("Start chapter");
    expect(attentionPipelineHtml).not.toContain("Resume chapter");

    const pausedReaderHtml = renderToStaticMarkup(
      <ChapterReaderClient
        initial={{
          projectId: "prj_001",
          chapter: { id: "ch_tech", number: 1, title: "Introduction", status: "needs_attention" },
          attention: buildTechnicalErrorAttention(),
          markdown: "",
          headings: [],
          citations: [],
          versions: [],
          verifiedClaimsCount: 0,
          originalityReport: null,
        }}
      />
    );
    expect(pausedReaderHtml).toContain("Resume Chapter 1");
    expect(pausedReaderHtml).toContain("temporary service issue");
    expect(pausedReaderHtml).not.toContain("Light edit");
    expect(pausedReaderHtml).not.toContain("@citeKey");
    expect(pausedReaderHtml).not.toMatch(/\bmetadata\b/i);
    expect(pausedReaderHtml).toContain("view its verified source details");
  });

  it("uses student-friendly Research copy without Workspace and computes auto-hide scrollbar metrics accurately", () => {
    const emptyOverviewHtml = renderToStaticMarkup(
      <OverviewLedgerClient
        recentProjects={[]}
        totalProjects={0}
        attentionItems={[]}
        freeSweepsRemaining={3}
      />
    );
    expect(emptyOverviewHtml).toContain("Ready for your first topic");
    expect(emptyOverviewHtml).not.toMatch(/workspace/i);

    const scrollbarHtml = renderToStaticMarkup(<AutoHideScrollbar />);
    expect(scrollbarHtml).toContain('aria-hidden="true"');
    expect(scrollbarHtml).toContain('data-visible="false"');
    expect(scrollbarHtml).toContain('data-scrollable="false"');

    // Non-scrollable document
    expect(
      computeScrollbarMetrics({
        scrollTop: 0,
        scrollHeight: 800,
        clientHeight: 800,
        trackHeight: 788,
      }).scrollable
    ).toBe(false);

    // Invalid / boundary inputs
    expect(
      computeScrollbarMetrics({
        scrollTop: Number.NaN,
        scrollHeight: 0,
        clientHeight: 800,
        trackHeight: -10,
      }).scrollable
    ).toBe(false);

    // Normal scroll midpoint
    const mid = computeScrollbarMetrics({
      scrollTop: 500,
      scrollHeight: 2000,
      clientHeight: 1000,
      trackHeight: 800,
    });
    expect(mid.scrollable).toBe(true);
    expect(mid.thumbHeight).toBe(400);
    expect(mid.maxScrollTop).toBe(1000);
    expect(mid.maxThumbTop).toBe(400);
    expect(mid.thumbTop).toBe(200);

    // Extremely long document clamps thumb to minThumbHeight
    const longDoc = computeScrollbarMetrics({
      scrollTop: 100_000,
      scrollHeight: 50_000,
      clientHeight: 1000,
      trackHeight: 800,
      minThumbHeight: 36,
    });
    expect(longDoc.scrollable).toBe(true);
    expect(longDoc.thumbHeight).toBe(36);
    expect(longDoc.thumbTop).toBe(764);

    // Drag-to-scroll math + clamping
    expect(
      computeScrollTopFromDrag({
        startScrollTop: 200,
        deltaY: 100,
        maxScrollTop: 1000,
        maxThumbTop: 400,
      })
    ).toBe(450);
    expect(
      computeScrollTopFromDrag({
        startScrollTop: 900,
        deltaY: 500,
        maxScrollTop: 1000,
        maxThumbTop: 400,
      })
    ).toBe(1000);
    expect(
      computeScrollTopFromDrag({
        startScrollTop: 50,
        deltaY: -500,
        maxScrollTop: 1000,
        maxThumbTop: 400,
      })
    ).toBe(0);
    expect(
      computeScrollTopFromDrag({
        startScrollTop: 100,
        deltaY: 10,
        maxScrollTop: 0,
        maxThumbTop: 0,
      })
    ).toBe(0);
  });
});
