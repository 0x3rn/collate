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
import { RouteProgressBar } from "@/components/layout/route-progress-bar";
import { ChapterPipelinePanel } from "@/components/project/chapter-pipeline-panel";
import { ChapterReaderClient } from "@/components/project/chapter-reader-client";
import { ChapterRichEditor } from "@/components/project/chapter-rich-editor";
import { IntegrityPanel } from "@/components/project/integrity-panel";
import { Button } from "@/components/ui/button";
import { LedgerRowsSkeleton } from "@/components/ui/skeleton";
import type { DashboardProjectSummary, UserExportItem } from "@/db/queries/dashboard";
import type { CslItem } from "@/lib/citations/csl";
import { buildReaderCitationLabels } from "@/lib/citations/reader-format";
import { formatCredits, formatNumber } from "@/lib/ui/formatters";
import { shouldTriggerRouteProgress } from "@/lib/ui/route-progress";
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
  useSearchParams: () => new URLSearchParams(),
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
  chapterVersion: null,
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
    expect(html).not.toContain('href="/terms"');
    expect(html).not.toContain('href="/privacy"');
    expect(html).not.toContain('href="/acceptable-use"');
    expect(html).not.toContain('href="/cookies"');
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
    expect(dirHtml).toContain("Ongoing");
    expect(dirHtml).not.toContain(">Active<");
    expect(dirHtml).toContain("Completed");
    expect(dirHtml).toContain("Archived");
    expect(dirHtml).toContain("Solar Microgrid Reliability in Rural Clinics");
    expect(dirHtml).toContain("3 of 5 chapters drafted");
    expect(dirHtml).toContain("60%");
    expect(dirHtml).toContain("Review Chapter 3");
    // Column is named for what it shows; the target length and citation style stay on the project page
    expect(dirHtml).toContain(">Sources</div>");
    expect(dirHtml).not.toContain(">Evidence<");
    expect(dirHtml).not.toContain("80p");
    expect(dirHtml).not.toContain("APA 7");
    // Clicking the project title navigates to the main project overview page, while the CTA opens Chapter 3
    expect(dirHtml).toContain(
      'href="/projects/prj_001" title="Solar Microgrid Reliability in Rural Clinics"'
    );
    expect(dirHtml).toContain('href="/projects/prj_001/chapters/ch_3"');

    const cardHtml = renderToStaticMarkup(<ProjectCard project={SAMPLE_PROJECT} />);
    expect(cardHtml).not.toContain("APA 7");
    expect(cardHtml).toContain("38 sources");
    expect(cardHtml).toContain(
      '<a href="/projects/prj_001" class="hover:text-[var(--accent-600)] transition-colors">Solar Microgrid Reliability in Rural Clinics</a>'
    );

    const exportsHtml = renderToStaticMarkup(
      <ExportsLibraryClient exportsList={[SAMPLE_EXPORT]} />
    );
    expect(exportsHtml).toContain("Full manuscript");
    expect(exportsHtml).toContain("82 pages");
    expect(exportsHtml).toContain("1.4 MB");
    expect(exportsHtml).toContain(
      'href="/api/projects/prj_001/exports/exp_001/download?exp=9999999999&amp;sig=test"'
    );
    // Full manuscripts span many chapters, so only single-chapter exports show a version
    expect(exportsHtml).not.toContain("Version");

    const chapterExportHtml = renderToStaticMarkup(
      <ExportsLibraryClient
        exportsList={[
          {
            ...SAMPLE_EXPORT,
            id: "exp_002",
            scope: "chapter",
            format: "docx",
            chapterId: "ch_1",
            chapterNumber: 1,
            chapterTitle: "Introduction",
            chapterVersion: 3,
          },
        ]}
      />
    );
    expect(chapterExportHtml).toContain("Chapter 1 (Introduction) · Version 3");
  });

  it("renders plain-language billing and account panels without developer jargon", () => {
    const billingHtml = renderToStaticMarkup(
      <CreditsPanel
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
    expect(billingHtml).toContain("Buy 25 credits");
    expect(billingHtml).toContain("Buy 100 credits");
    expect(billingHtml).toContain("Buy 200 credits");
    expect(billingHtml).toContain("$10");
    expect(billingHtml).toContain("$30");
    expect(billingHtml).toContain("$50");
    expect(billingHtml).not.toMatch(/paystack|polar|stripe/i);
    expect(billingHtml).not.toContain("Recent ledger");
    expect(billingHtml).not.toContain("sweep_fee");

    const prefsHtml = renderToStaticMarkup(
      <NotificationPrefsForm
        initialPrefs={{
          emailChapterReady: true,
          emailNeedsAttention: true,
          emailProjectComplete: true,
          emailReceipts: true,
          emailMarketing: false,
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
    expect(workbenchHtml).toContain(
      "Enter your project title to jump straight into setup, or leave it blank to refine it next."
    );
    expect(workbenchHtml).toContain(
      "Sources are verified against research indexes before any chapter drafting starts."
    );
    expect(workbenchHtml).toContain("Research paper");
    expect(workbenchHtml).toContain("Thesis");
    expect(workbenchHtml).toContain("Assignment");
    expect(workbenchHtml).toContain("Start project");

    // Each work type tab renders tailored heading, subtitle, button, and verification copy.
    for (const [type, button, expectedSubtitle, expectedFooter] of [
      [
        "research",
        "Start research paper",
        "Enter your research paper title to jump straight into setup, or leave it blank to refine it next.",
        "Sources are verified against research indexes before any chapter drafting starts.",
      ],
      [
        "thesis",
        "Start thesis",
        "Enter your thesis title to jump straight into setup, or leave it blank to refine it next.",
        "Sources are verified against research indexes before any chapter drafting starts.",
      ],
      [
        "assignment",
        "Start assignment",
        "Enter your assignment or course title to begin, then add your questions on the next screen.",
        "Sources are verified for each question before any answer drafting starts.",
      ],
    ] as const) {
      const html = renderToStaticMarkup(<QuickStartWorkbench initialType={type} />);
      expect(html).toContain(`<span>${button}</span>`);
      expect(html).toContain(expectedSubtitle);
      expect(html).toContain(expectedFooter);
      expect(html).not.toContain("Start project");
      if (type === "assignment") {
        expect(html).not.toContain("chapter drafting");
      }
    }

    const overviewHtml = renderToStaticMarkup(
      <OverviewLedgerClient
        recentProjects={[SAMPLE_PROJECT]}
        totalProjects={1}
        attentionItems={[]}
        freeSweepsRemaining={3}
      />
    );
    expect(overviewHtml).toContain("Recent work");
    expect(overviewHtml).toContain("Ongoing");
    expect(overviewHtml).not.toContain(">Active<");
    expect(overviewHtml).toContain("Needs review");
    expect(overviewHtml).toContain("Solar Microgrid Reliability in Rural Clinics");
    expect(overviewHtml).toContain(
      'href="/projects/prj_001" title="Solar Microgrid Reliability in Rural Clinics"'
    );

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
            userInstructions: "Highlight primary MDA biomarker measurements.",
            userAttachmentName: "lab_biomarkers.csv",
            userAttachmentKind: "csv",
            hasUserDataTables: true,
          },
          {
            id: "ch_5",
            number: 5,
            title: "Discussion",
            chapterType: "discussion",
            pageBudget: 6,
            wordBudget: 1650,
            isAutoReferences: false,
            status: "ready",
            hasDraftVersion: true,
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
    expect(chaptersHtml).toContain("Add instructions (optional)");
    expect(chaptersHtml).toContain("Edit instructions");
    expect(chaptersHtml).toContain("Pre-start instructions saved");
    expect(chaptersHtml).toContain("lab_biomarkers.csv");
    // Started/ready chapter shows Request changes instead of Add instructions
    expect(chaptersHtml).toContain("Request changes");
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
      "Optional. Only use if your institution requires an AI-use disclosure."
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

    // Ready chapter button order: Read / edit -> Request changes -> Approve Chapter (3rd) -> Download (last)
    const readyPipelineHtml = renderToStaticMarkup(
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
            status: "ready",
            sectionHeadings: ["Background"],
          },
          {
            id: "ch_2",
            number: 2,
            title: "Literature Review",
            chapterType: "literature_review",
            pageBudget: 12,
            wordBudget: 3300,
            isAutoReferences: false,
            status: "not_started",
            sectionHeadings: ["Conceptual review"],
          },
        ]}
      />
    );
    const readIdx = readyPipelineHtml.indexOf("Read / edit");
    const reviseIdx = readyPipelineHtml.indexOf("Request changes");
    const approveIdx = readyPipelineHtml.indexOf("Approve Chapter");
    const downloadIdx = readyPipelineHtml.indexOf(">Download<");
    expect(readIdx).toBeGreaterThan(-1);
    expect(reviseIdx).toBeGreaterThan(readIdx);
    expect(approveIdx).toBeGreaterThan(reviseIdx);
    expect(downloadIdx).toBeGreaterThan(approveIdx);
    expect(readyPipelineHtml).toContain("justify-end");
    expect(readyPipelineHtml).toContain("bg-[var(--warning-bg)]");
    expect(readyPipelineHtml).toContain("Ready for review");

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

    // Formatted Harvard inline citations, italicized species names, no duplicate H1, and plain-language checks
    const cslRegistry = new Map<string, CslItem>([
      [
        "poncedvila2026",
        {
          id: "poncedvila2026",
          type: "article-journal",
          title: "Impact of beetroot juice on oxidative stress",
          author: [
            { family: "Ponce de Vila", given: "M." },
            { family: "Lopez", given: "A." },
            { family: "Ruiz", given: "C." },
          ],
          issued: { "date-parts": [[2026]] },
          "container-title": "Nutrition and Health",
          DOI: "10.1177/02601060261416845",
        },
      ],
      [
        "darvish2024",
        {
          id: "darvish2024",
          type: "article-journal",
          title: "Nitrate-rich beetroot juice alters ROS bioactivity",
          author: [{ family: "Darvish", given: "S." }],
          issued: { "date-parts": [[2024]] },
          "container-title": "Physiology",
        },
      ],
    ]);
    const chapterMd = [
      "# Chapter 1: Introduction",
      "",
      "## 1.1 Background of the study",
      "",
      "Beetroot (*Beta vulgaris*) lowers oxidative stress [@poncedvila2026] and improves redox balance [@poncedvila2026; @darvish2024].",
      "",
      ":::figure",
      "url: https://upload.wikimedia.org/wikipedia/commons/thumb/4/45/Beetroot.jpg/800px-Beetroot.jpg",
      "alt: Fresh Beta vulgaris roots",
      "caption: Figure 1.1: Fresh *Beta vulgaris* (beetroot) roots.",
      "attribution: Source: Wikimedia Commons · Photo by Example Author · CC BY-SA 4.0 (https://commons.wikimedia.org/wiki/File:Beetroot.jpg)",
      "width: 800",
      "height: 533",
      ":::",
      "",
      "<!-- pagebreak -->",
      "",
      "## 1.2 Statement of the problem",
      "",
      "Second page begins cleanly here.",
    ].join("\n");
    const readerLabels = buildReaderCitationLabels({
      markdown: chapterMd,
      registry: cslRegistry,
      style: "harvard",
    });
    expect(readerLabels.clusters["[@poncedvila2026]"]?.label).toBe("(Ponce de Vila et al. 2026)");
    expect(readerLabels.clusters["[@poncedvila2026; @darvish2024]"]?.label).toBe(
      "(Ponce de Vila et al. 2026; Darvish 2024)"
    );

    const readyReaderHtml = renderToStaticMarkup(
      <ChapterReaderClient
        initial={{
          projectId: "prj_001",
          chapter: { id: "ch_1", number: 1, title: "Introduction", status: "ready" },
          markdown: chapterMd,
          headings: [{ id: "sec-1", text: "1.1 Background of the study", level: 2 }],
          citationClusters: readerLabels.clusters,
          citations: [
            {
              citeKey: "poncedvila2026",
              inlineLabel: readerLabels.singleKeyLabels["poncedvila2026"],
              title: "Impact of beetroot juice on oxidative stress",
              year: 2026,
              venue: "Nutrition and Health",
              doi: "10.1177/02601060261416845",
              url: null,
            },
            {
              citeKey: "darvish2024",
              inlineLabel: readerLabels.singleKeyLabels["darvish2024"],
              title: "Nitrate-rich beetroot juice alters ROS bioactivity",
              year: 2024,
              venue: "Physiology",
              doi: null,
              url: null,
            },
          ],
          versions: [
            {
              id: "ver_1",
              version: 1,
              wordCount: 1985,
              pageCount: 7,
              createdBy: "ai",
              revisionNotes: null,
              createdAt: "2026-11-24T10:28:53.000Z",
            },
          ],
          verifiedClaimsCount: 12,
          originalityReport: {
            passed: true,
            overlapScore: 1.4,
            semanticScore: 75.2,
            quoteSharePct: 0,
            crossUserScore: 0,
          },
        }}
      />
    );
    expect(readyReaderHtml).toContain("(Ponce de Vila et al. 2026)");
    expect(readyReaderHtml).toContain("(Ponce de Vila et al. 2026; Darvish 2024)");
    expect(readyReaderHtml).not.toContain("[@poncedvila2026]");
    // Inline citations render as true non-atomic inline elements (not centered <button> blocks)
    expect(readyReaderHtml).toContain('role="button" tabindex="0"');
    expect(readyReaderHtml).toContain("inline text-left [box-decoration-break:clone]");
    expect(readyReaderHtml).not.toContain('<button type="button" title=');
    expect(readyReaderHtml).toContain("<em>Beta vulgaris</em>");
    expect(readyReaderHtml).not.toContain("*Beta vulgaris*");
    expect(readyReaderHtml).not.toContain("Chapter 1: Introduction");
    expect(readyReaderHtml).toContain("Originality &amp; checks");
    expect(readyReaderHtml).toContain("Originality check");
    expect(readyReaderHtml).toContain("Matched source text");
    expect(readyReaderHtml).toContain("Shared across projects");
    expect(readyReaderHtml).not.toContain("Gate:");
    expect(readyReaderHtml).toContain("Draft history (1)");
    expect(readyReaderHtml).toContain("Version 1 · Original draft");
    expect(readyReaderHtml).not.toContain("AI draft");
    expect(readyReaderHtml).not.toContain("AI revision");
    expect(readyReaderHtml).toContain("Current");
    expect(readyReaderHtml).toContain("<figure");
    expect(readyReaderHtml).toContain("Source: Example Author, ");
    expect(readyReaderHtml).toContain(
      'href="https://commons.wikimedia.org/wiki/File:Beetroot.jpg"'
    );
    expect(readyReaderHtml).toContain(">Wikimedia Commons</a> (CC BY-SA 4.0)");
    // Raw File: URL is never printed as visible text inside the figcaption
    expect(readyReaderHtml).not.toContain("(https://commons.wikimedia.org/wiki/File:Beetroot.jpg)");
    // Read mode keeps subtle page indicators while hiding literal Page break editor bars
    expect(readyReaderHtml).not.toContain("Page break");
    expect(readyReaderHtml).toContain("~Page 1");
    expect(readyReaderHtml).toContain("~Page 2");

    const editorHtml = renderToStaticMarkup(
      <ChapterRichEditor
        projectId="prj_001"
        projectTitle="Beetroot Oxidative Stress Study"
        markdown={chapterMd}
        wordsPerPage={275}
        citationClusters={readerLabels.clusters}
        singleKeyLabels={readerLabels.singleKeyLabels}
        initialFigures={[]}
        onChange={() => {}}
      />
    );
    expect(editorHtml).toContain("+ Page break");
    expect(editorHtml).toContain("+ Verified image");
    expect(editorHtml).toContain("Markdown source");
    expect(editorHtml).toContain("Document size");
    expect(editorHtml).toContain("Page 1 · A4");
    expect(editorHtml).toContain("210 × 297 mm");
    // Editor displays clean plain-text attribution without raw URLs or File: clutter
    expect(editorHtml).toContain("Source: Example Author, Wikimedia Commons (CC BY-SA 4.0)");
    expect(editorHtml).not.toContain("File:Beetroot.jpg");
    expect(editorHtml).not.toContain("commons.wikimedia.org");

    // Multi-source untitled FDA citation normalizes stray punctuation space and shows org + host + year-suffix in inspector
    const fdaRegistry = new Map<string, CslItem>([
      [
        "fda_a",
        {
          id: "fda_a",
          type: "report",
          title: "[Untitled document]",
          author: [{ literal: "U.S. Food and Drug Administration" }],
          URL: "https://www.accessdata.fda.gov/drugsatfda_docs/label/2017/017854s062lbl.pdf",
        },
      ],
      [
        "fda_b",
        {
          id: "fda_b",
          type: "report",
          title: "REGLAN (metoclopramide) tablets",
          author: [{ literal: "U.S. Food and Drug Administration" }],
          URL: "https://www.accessdata.fda.gov/drugsatfda_docs/label/2011/017854s058lbl.pdf",
        },
      ],
    ]);
    const fdaMd = "Extrapyramidal reactions are documented [@fda_a; @fda_b] .";
    const fdaLabels = buildReaderCitationLabels({
      markdown: fdaMd,
      registry: fdaRegistry,
      style: "apa7",
    });
    expect(fdaLabels.authorLabels.fda_a).toBe("U.S. Food and Drug Administration");
    expect(fdaLabels.yearLabels.fda_a).toBe("n.d.‑a");
    expect(fdaLabels.yearLabels.fda_b).toBe("n.d.‑b");

    const fdaReaderHtml = renderToStaticMarkup(
      <ChapterReaderClient
        initial={{
          projectId: "prj_001",
          chapter: { id: "ch_1", number: 1, title: "Introduction", status: "ready" },
          markdown: fdaMd,
          headings: [],
          citationClusters: fdaLabels.clusters,
          citations: [
            {
              citeKey: "fda_a",
              inlineLabel: fdaLabels.singleKeyLabels.fda_a,
              title: "[Untitled document]",
              authors: fdaLabels.authorLabels.fda_a,
              year: null,
              yearLabel: fdaLabels.yearLabels.fda_a,
              venue: null,
              doi: null,
              url: "https://www.accessdata.fda.gov/drugsatfda_docs/label/2017/017854s062lbl.pdf",
            },
            {
              citeKey: "fda_b",
              inlineLabel: fdaLabels.singleKeyLabels.fda_b,
              title: "REGLAN (metoclopramide) tablets",
              authors: fdaLabels.authorLabels.fda_b,
              year: null,
              yearLabel: fdaLabels.yearLabels.fda_b,
              venue: null,
              doi: null,
              url: "https://www.accessdata.fda.gov/drugsatfda_docs/label/2011/017854s058lbl.pdf",
            },
          ],
          versions: [],
          verifiedClaimsCount: 1,
          originalityReport: null,
        }}
      />
    );
    // Space before trailing period is removed so "." stays attached to the citation pill
    expect(fdaReaderHtml).toContain("</span><span><span>.</span></span>");
    expect(fdaReaderHtml).not.toContain("</span><span><span> .</span></span>");
    // Citation inspector identifies the untitled FDA PDF by organisation, host, and lettered year
    expect(fdaReaderHtml).toContain("U.S. Food and Drug Administration");
    expect(fdaReaderHtml).toContain("Untitled document");
    expect(fdaReaderHtml).toContain("accessdata.fda.gov · n.d.‑a");
    expect(fdaReaderHtml).not.toContain(">[Untitled document]<");
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

  it("triggers global RouteProgressBar only for in-app page navigations and stays idle on SSR", () => {
    // Renders cleanly on SSR as empty when idle (no flash on initial page load)
    expect(renderToStaticMarkup(<RouteProgressBar />)).toBe("");

    const currentHref = "https://collate.app/projects";
    // Internal page transitions -> true
    expect(shouldTriggerRouteProgress({ href: "/dashboard", currentHref })).toBe(true);
    expect(shouldTriggerRouteProgress({ href: "/projects/prj_123", currentHref })).toBe(true);
    expect(shouldTriggerRouteProgress({ href: "/projects?tab=completed", currentHref })).toBe(true);
    expect(shouldTriggerRouteProgress({ href: "/admin", target: "_self", currentHref })).toBe(true);

    // Non-navigation or same-page links -> false
    expect(shouldTriggerRouteProgress({ href: "/projects", currentHref })).toBe(false);
    expect(shouldTriggerRouteProgress({ href: "/projects#top", currentHref })).toBe(false);
    expect(shouldTriggerRouteProgress({ href: "#features", currentHref })).toBe(false);
    expect(
      shouldTriggerRouteProgress({
        href: "/api/projects/prj_1/exports/exp_1/download",
        currentHref,
      })
    ).toBe(false);
    expect(shouldTriggerRouteProgress({ href: "/dashboard", target: "_blank", currentHref })).toBe(
      false
    );
    expect(shouldTriggerRouteProgress({ href: "/dashboard", hasDownload: true, currentHref })).toBe(
      false
    );
    expect(
      shouldTriggerRouteProgress({ href: "/dashboard", ariaDisabled: "true", currentHref })
    ).toBe(false);
    expect(shouldTriggerRouteProgress({ href: "https://doi.org/10.1000/xyz", currentHref })).toBe(
      false
    );
    expect(shouldTriggerRouteProgress({ href: "mailto:help@collate.app", currentHref })).toBe(
      false
    );
    expect(shouldTriggerRouteProgress({ href: "", currentHref })).toBe(false);
  });
});
