import { and, asc, eq } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import {
  chapters,
  feasibilityReports,
  projects,
  projectSettings,
  questions,
  type ChapterRecord,
  type FeasibilityReportRecord,
  type ProjectRecord,
  type ProjectSettingsRecord,
  type ProjectType,
  type QuestionRecord,
} from "@/db/schema";
import {
  allocateChapterBudgets,
  CoverDetailsSchema,
  DEFAULT_COVER_DETAILS,
  DEFAULT_FRONT_MATTER,
  FrontMatterTogglesSchema,
  getDefaultChaptersForType,
  recommendMockIdealPages,
  WizardStepPayloadSchema,
  type CoverDetails,
  type FrontMatterToggles,
} from "@/lib/wizard/schema";

export class WizardError extends Error {
  public readonly code: "NOT_FOUND" | "VALIDATION_ERROR";
  public readonly status: number;

  constructor(code: "NOT_FOUND" | "VALIDATION_ERROR", message: string, status: number) {
    super(message);
    this.name = "WizardError";
    this.code = code;
    this.status = status;
  }
}

export interface HydratedWizardState {
  project: ProjectRecord;
  settings: Omit<ProjectSettingsRecord, "frontMatterJson" | "coverJson"> & {
    frontMatter: FrontMatterToggles;
    cover: CoverDetails;
  };
  questions: QuestionRecord[];
  chapters: ChapterRecord[];
  feasibilityReports: Array<
    Omit<FeasibilityReportRecord, "reasonsJson" | "coverageJson"> & {
      reasons: string[];
      coverage: { sourcesFound: number; subtopicsCovered: number; idealPagesReason: string };
    }
  >;
}

function safeParseFrontMatter(raw: string): FrontMatterToggles {
  try {
    return FrontMatterTogglesSchema.parse(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_FRONT_MATTER };
  }
}

function safeParseCover(raw: string): CoverDetails {
  try {
    return CoverDetailsSchema.parse(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_COVER_DETAILS };
  }
}

async function ensureDefaultSettings(
  db: AppDb,
  projectId: string,
  now: Date
): Promise<ProjectSettingsRecord> {
  const existing = await db
    .select()
    .from(projectSettings)
    .where(eq(projectSettings.projectId, projectId))
    .limit(1);

  if (existing[0]) return existing[0];

  const [created] = await db
    .insert(projectSettings)
    .values({
      projectId,
      citationStyle: "apa7",
      inlineMode: "inline_and_list",
      font: "Times New Roman",
      fontSizePt: 12,
      lineSpacing: "double",
      marginsMm: 25,
      pageNumbering: true,
      spelling: "uk",
      frontMatterJson: JSON.stringify(DEFAULT_FRONT_MATTER),
      coverJson: JSON.stringify(DEFAULT_COVER_DETAILS),
      updatedAt: now,
    })
    .returning();

  if (!created) {
    throw new Error("Failed to initialize default project settings");
  }
  return created;
}

export async function createWizardDraftProject(
  db: AppDb,
  userId: string,
  type: ProjectType,
  now: Date = new Date()
): Promise<HydratedWizardState> {
  if (!userId.trim()) {
    throw new WizardError("VALIDATION_ERROR", "Authenticated userId is required.", 400);
  }

  const projectId = `prj_${crypto.randomUUID()}`;
  const defaultTitle = type === "assignment" ? "Untitled assignment" : `Untitled ${type}`;

  await db.insert(projects).values({
    id: projectId,
    userId,
    type,
    title: defaultTitle,
    status: "draft",
    wizardStep: 2,
    createdAt: now,
    updatedAt: now,
  });

  await ensureDefaultSettings(db, projectId, now);

  if (type !== "assignment") {
    const defaults = getDefaultChaptersForType(type);
    const { idealPages } = recommendMockIdealPages({ type });
    const budgeted = allocateChapterBudgets(defaults, idealPages, "double");
    for (const ch of budgeted) {
      await db.insert(chapters).values({
        id: `chp_${crypto.randomUUID()}`,
        projectId,
        number: ch.number,
        title: ch.title,
        chapterType: ch.chapterType,
        pageBudget: ch.pageBudget,
        wordBudget: ch.wordBudget,
        isAutoReferences: false,
        status: "not_started",
        createdAt: now,
        updatedAt: now,
      });
    }
    await db.insert(chapters).values({
      id: `chp_${crypto.randomUUID()}`,
      projectId,
      number: budgeted.length + 1,
      title: "References",
      chapterType: "references",
      pageBudget: null,
      wordBudget: null,
      isAutoReferences: true,
      status: "not_started",
      createdAt: now,
      updatedAt: now,
    });
  }

  const hydrated = await getWizardStateForUser(db, userId, projectId);
  if (!hydrated) {
    throw new Error("Failed to load newly created draft project");
  }
  return hydrated;
}

export async function getWizardStateForUser(
  db: AppDb,
  userId: string,
  projectId: string
): Promise<HydratedWizardState | null> {
  if (!userId.trim() || !projectId.trim()) return null;

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);

  if (!project) return null;

  const settingsRow = await ensureDefaultSettings(db, project.id, new Date());

  const questionRows = await db
    .select()
    .from(questions)
    .where(eq(questions.projectId, project.id))
    .orderBy(asc(questions.orderIndex));

  const chapterRows = await db
    .select()
    .from(chapters)
    .where(eq(chapters.projectId, project.id))
    .orderBy(asc(chapters.number));

  const reportRows = await db
    .select()
    .from(feasibilityReports)
    .where(eq(feasibilityReports.projectId, project.id));

  return {
    project,
    settings: {
      projectId: settingsRow.projectId,
      citationStyle: settingsRow.citationStyle,
      inlineMode: settingsRow.inlineMode,
      font: settingsRow.font,
      fontSizePt: settingsRow.fontSizePt,
      lineSpacing: settingsRow.lineSpacing,
      marginsMm: settingsRow.marginsMm,
      pageNumbering: settingsRow.pageNumbering,
      spelling: settingsRow.spelling,
      updatedAt: settingsRow.updatedAt,
      frontMatter: safeParseFrontMatter(settingsRow.frontMatterJson),
      cover: safeParseCover(settingsRow.coverJson),
    },
    questions: questionRows,
    chapters: chapterRows,
    feasibilityReports: reportRows.map((row) => {
      let reasons: string[];
      let coverage = { sourcesFound: 0, subtopicsCovered: 0, idealPagesReason: "" };
      try {
        reasons = JSON.parse(row.reasonsJson) as string[];
      } catch {
        reasons = [];
      }
      try {
        coverage = JSON.parse(row.coverageJson) as typeof coverage;
      } catch {
        // Keep defaults
      }
      return {
        id: row.id,
        projectId: row.projectId,
        questionId: row.questionId,
        verdict: row.verdict,
        score: row.score,
        isMocked: row.isMocked,
        createdAt: row.createdAt,
        reasons,
        coverage,
      };
    }),
  };
}

export async function saveWizardStepForUser(
  db: AppDb,
  userId: string,
  projectId: string,
  rawPayload: unknown,
  now: Date = new Date()
): Promise<HydratedWizardState> {
  const existing = await getWizardStateForUser(db, userId, projectId);
  if (!existing) {
    throw new WizardError("NOT_FOUND", "Project not found.", 404);
  }

  const parsed = WizardStepPayloadSchema.safeParse(rawPayload);
  if (!parsed.success) {
    throw new WizardError(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Check your selections and try again.",
      400
    );
  }

  const payload = parsed.data;

  if (payload.step === 1) {
    await db
      .update(projects)
      .set({
        type: payload.type,
        wizardStep: Math.max(existing.project.wizardStep, 2),
        updatedAt: now,
      })
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));

    if (payload.type === "assignment") {
      await db.delete(chapters).where(eq(chapters.projectId, projectId));
    } else if (existing.chapters.length === 0) {
      const defaults = getDefaultChaptersForType(payload.type);
      const { idealPages } = recommendMockIdealPages({ type: payload.type });
      const budgeted = allocateChapterBudgets(defaults, idealPages, existing.settings.lineSpacing);
      for (const ch of budgeted) {
        await db.insert(chapters).values({
          id: `chp_${crypto.randomUUID()}`,
          projectId,
          number: ch.number,
          title: ch.title,
          chapterType: ch.chapterType,
          pageBudget: ch.pageBudget,
          wordBudget: ch.wordBudget,
          isAutoReferences: false,
          status: "not_started",
          createdAt: now,
          updatedAt: now,
        });
      }
      await db.insert(chapters).values({
        id: `chp_${crypto.randomUUID()}`,
        projectId,
        number: budgeted.length + 1,
        title: "References",
        chapterType: "references",
        isAutoReferences: true,
        status: "not_started",
        createdAt: now,
        updatedAt: now,
      });
    }
  } else if (payload.step === 2) {
    if (existing.project.type === "assignment") {
      const list = payload.questions ?? [];
      if (list.length === 0) {
        throw new WizardError(
          "VALIDATION_ERROR",
          "Add at least one assignment question before continuing.",
          400
        );
      }

      await db.delete(questions).where(eq(questions.projectId, projectId));
      for (let i = 0; i < list.length; i++) {
        await db.insert(questions).values({
          id: `qst_${crypto.randomUUID()}`,
          projectId,
          text: list[i]!,
          orderIndex: i + 1,
          createdAt: now,
        });
      }
    }

    await db
      .update(projects)
      .set({
        title: payload.title,
        field: payload.field || null,
        level: payload.level || null,
        institution: payload.institution || null,
        supervisorNotes: payload.supervisorNotes || null,
        wizardStep: Math.max(existing.project.wizardStep, 3),
        updatedAt: now,
      })
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
  } else if (payload.step === 3) {
    // Mock research sweep for Phase 2 (replaced by real ResearchSweep Workflow in Phases 3 & 4)
    const { idealPages, reason } = recommendMockIdealPages({
      type: existing.project.type,
      level: existing.project.level,
      questionCount: existing.questions.length,
    });

    await db.delete(feasibilityReports).where(eq(feasibilityReports.projectId, projectId));

    const verdict = payload.simulateVerdict;
    const score = verdict === "feasible" ? 84 : verdict === "needs_refinement" ? 56 : 22;
    const mockReasons =
      verdict === "feasible"
        ? [
            "Mock check: sufficient scholarly and web coverage simulated for Phase 2 wizard testing.",
            "Real multi-source verification and DOI checks will replace this screen in Phases 3 and 4.",
          ]
        : verdict === "needs_refinement"
          ? [
              "Mock check: topic scope appears broad; narrowing the region or timeframe is recommended.",
            ]
          : [
              "Mock check: insufficient verifiable sources found to draft this topic without guessing.",
            ];

    if (existing.project.type === "assignment" && existing.questions.length > 0) {
      for (const q of existing.questions) {
        await db.insert(feasibilityReports).values({
          id: `fsr_${crypto.randomUUID()}`,
          projectId,
          questionId: q.id,
          verdict,
          score,
          reasonsJson: JSON.stringify(mockReasons),
          coverageJson: JSON.stringify({
            sourcesFound: verdict === "not_feasible" ? 2 : 14,
            subtopicsCovered: verdict === "not_feasible" ? 1 : 3,
            idealPagesReason: reason,
          }),
          isMocked: true,
          createdAt: now,
        });
      }
    } else {
      await db.insert(feasibilityReports).values({
        id: `fsr_${crypto.randomUUID()}`,
        projectId,
        questionId: null,
        verdict,
        score,
        reasonsJson: JSON.stringify(mockReasons),
        coverageJson: JSON.stringify({
          sourcesFound: verdict === "not_feasible" ? 3 : 38,
          subtopicsCovered: verdict === "not_feasible" ? 1 : 6,
          idealPagesReason: reason,
        }),
        isMocked: true,
        createdAt: now,
      });
    }

    await db
      .update(projects)
      .set({
        status: verdict,
        idealPages,
        targetPages: existing.project.targetPages ?? idealPages,
        wizardStep: verdict === "feasible" ? Math.max(existing.project.wizardStep, 4) : 3,
        updatedAt: now,
      })
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
  } else if (payload.step === 4) {
    const nextStep = existing.project.type === "assignment" ? 6 : 5;
    await db
      .update(projects)
      .set({
        targetPages: payload.targetPages,
        wizardStep: Math.max(existing.project.wizardStep, nextStep),
        updatedAt: now,
      })
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));

    // Recompute chapter page budgets if chapters already exist
    const nonRefChapters = existing.chapters.filter((ch) => !ch.isAutoReferences);
    if (nonRefChapters.length > 0) {
      const rebudgeted = allocateChapterBudgets(
        nonRefChapters.map((c) => ({ number: c.number, title: c.title })),
        payload.targetPages,
        existing.settings.lineSpacing
      );
      for (const item of rebudgeted) {
        await db
          .update(chapters)
          .set({
            pageBudget: item.pageBudget,
            wordBudget: item.wordBudget,
            updatedAt: now,
          })
          .where(and(eq(chapters.projectId, projectId), eq(chapters.number, item.number)));
      }
    }
  } else if (payload.step === 5) {
    if (existing.project.type === "assignment") {
      throw new WizardError(
        "VALIDATION_ERROR",
        "Assignments use question lists rather than chapters.",
        400
      );
    }

    const sorted = [...payload.chapters].sort((a, b) => a.number - b.number);
    const targetPages = existing.project.targetPages ?? existing.project.idealPages ?? 50;
    const budgeted = allocateChapterBudgets(sorted, targetPages, existing.settings.lineSpacing);
    const maxChapterNum = budgeted.reduce((max, item) => Math.max(max, item.number), 0);

    await db.delete(chapters).where(eq(chapters.projectId, projectId));
    for (const ch of budgeted) {
      await db.insert(chapters).values({
        id: `chp_${crypto.randomUUID()}`,
        projectId,
        number: ch.number,
        title: ch.title,
        chapterType: ch.chapterType,
        pageBudget: ch.pageBudget,
        wordBudget: ch.wordBudget,
        isAutoReferences: false,
        status: "not_started",
        createdAt: now,
        updatedAt: now,
      });
    }

    // Automatically append References chapter assembled by the citation engine (Section 5 & 7)
    await db.insert(chapters).values({
      id: `chp_${crypto.randomUUID()}`,
      projectId,
      number: maxChapterNum + 1,
      title: "References",
      chapterType: "references",
      pageBudget: null,
      wordBudget: null,
      isAutoReferences: true,
      status: "not_started",
      createdAt: now,
      updatedAt: now,
    });

    await db
      .update(projectSettings)
      .set({
        frontMatterJson: JSON.stringify(payload.frontMatter),
        updatedAt: now,
      })
      .where(eq(projectSettings.projectId, projectId));

    await db
      .update(projects)
      .set({
        wizardStep: Math.max(existing.project.wizardStep, 6),
        updatedAt: now,
      })
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
  } else if (payload.step === 6) {
    await db
      .update(projectSettings)
      .set({
        citationStyle: payload.citationStyle,
        inlineMode: payload.inlineMode,
        updatedAt: now,
      })
      .where(eq(projectSettings.projectId, projectId));

    await db
      .update(projects)
      .set({
        wizardStep: Math.max(existing.project.wizardStep, 7),
        updatedAt: now,
      })
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
  } else if (payload.step === 7) {
    await db
      .update(projectSettings)
      .set({
        font: payload.font,
        fontSizePt: payload.fontSizePt,
        lineSpacing: payload.lineSpacing,
        marginsMm: payload.marginsMm,
        pageNumbering: payload.pageNumbering,
        spelling: payload.spelling,
        coverJson: JSON.stringify(payload.cover),
        updatedAt: now,
      })
      .where(eq(projectSettings.projectId, projectId));

    await db
      .update(projects)
      .set({
        wizardStep: 8,
        updatedAt: now,
      })
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
  } else if (payload.step === 8) {
    await db
      .update(projects)
      .set({
        status: "outline_pending",
        wizardStep: 8,
        updatedAt: now,
      })
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
  }

  const refreshed = await getWizardStateForUser(db, userId, projectId);
  if (!refreshed) {
    throw new Error("Failed to reload wizard state after save");
  }
  return refreshed;
}
