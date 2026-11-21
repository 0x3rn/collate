import { z } from "zod";
import {
  createWizardDraftProject,
  getWizardStateForUser,
  saveWizardStepForUser,
  WizardError,
  type HydratedWizardState,
} from "@/db/queries/wizard";
import { PROJECT_TYPES } from "@/db/schema";
import { isAllowedOrigin, jsonNoStore, readSessionTokenFromRequest } from "@/lib/auth/cookies";
import type { HttpAuthDeps } from "@/lib/auth/http-handlers";
import { getSessionFromToken } from "@/lib/auth/service";
import { logEvent } from "@/lib/observability/logger";

export interface SerializedWizardState {
  project: {
    id: string;
    type: HydratedWizardState["project"]["type"];
    title: string;
    level: string | null;
    field: string | null;
    institution: string | null;
    supervisorNotes: string | null;
    status: HydratedWizardState["project"]["status"];
    wizardStep: number;
    targetPages: number | null;
    idealPages: number | null;
    createdAt: string;
    updatedAt: string;
  };
  settings: {
    citationStyle: HydratedWizardState["settings"]["citationStyle"];
    inlineMode: HydratedWizardState["settings"]["inlineMode"];
    font: string;
    fontSizePt: number;
    lineSpacing: HydratedWizardState["settings"]["lineSpacing"];
    marginsMm: number;
    pageNumbering: boolean;
    spelling: HydratedWizardState["settings"]["spelling"];
    frontMatter: HydratedWizardState["settings"]["frontMatter"];
    cover: HydratedWizardState["settings"]["cover"];
    updatedAt: string;
  };
  questions: Array<{
    id: string;
    text: string;
    orderIndex: number;
  }>;
  chapters: Array<{
    id: string;
    number: number;
    title: string;
    chapterType: string;
    brief: string | null;
    pageBudget: number | null;
    wordBudget: number | null;
    isAutoReferences: boolean;
    status: HydratedWizardState["chapters"][number]["status"];
  }>;
  feasibilityReports: Array<{
    id: string;
    questionId: string | null;
    verdict: HydratedWizardState["feasibilityReports"][number]["verdict"];
    score: number;
    isMocked: boolean;
    reasons: string[];
    coverage: {
      sourcesFound: number;
      credibleRelevantSources?: number;
      accessibleSources?: number;
      distinctDomains?: number;
      subtopicsCovered: number;
      totalSubtopics?: number;
      idealPagesReason: string;
      requiresPrimaryData?: boolean;
      primaryDataNotice?: string | null;
      suggestedRefinements?: string[];
      subtopicBreakdown?: Array<{ subtopic: string; credibleSources: number; covered: boolean }>;
    };
    createdAt: string;
  }>;
}

export function serializeWizardState(state: HydratedWizardState): SerializedWizardState {
  return {
    project: {
      id: state.project.id,
      type: state.project.type,
      title: state.project.title,
      level: state.project.level,
      field: state.project.field,
      institution: state.project.institution,
      supervisorNotes: state.project.supervisorNotes,
      status: state.project.status,
      wizardStep: state.project.wizardStep,
      targetPages: state.project.targetPages,
      idealPages: state.project.idealPages,
      createdAt: state.project.createdAt.toISOString(),
      updatedAt: state.project.updatedAt.toISOString(),
    },
    settings: {
      citationStyle: state.settings.citationStyle,
      inlineMode: state.settings.inlineMode,
      font: state.settings.font,
      fontSizePt: state.settings.fontSizePt,
      lineSpacing: state.settings.lineSpacing,
      marginsMm: state.settings.marginsMm,
      pageNumbering: state.settings.pageNumbering,
      spelling: state.settings.spelling,
      frontMatter: state.settings.frontMatter,
      cover: state.settings.cover,
      updatedAt: state.settings.updatedAt.toISOString(),
    },
    questions: state.questions.map((q) => ({
      id: q.id,
      text: q.text,
      orderIndex: q.orderIndex,
    })),
    chapters: state.chapters.map((ch) => ({
      id: ch.id,
      number: ch.number,
      title: ch.title,
      chapterType: ch.chapterType,
      brief: ch.brief,
      pageBudget: ch.pageBudget,
      wordBudget: ch.wordBudget,
      isAutoReferences: ch.isAutoReferences,
      status: ch.status,
    })),
    feasibilityReports: state.feasibilityReports.map((rep) => ({
      id: rep.id,
      questionId: rep.questionId,
      verdict: rep.verdict,
      score: rep.score,
      isMocked: rep.isMocked,
      reasons: rep.reasons,
      coverage: rep.coverage,
      createdAt: rep.createdAt.toISOString(),
    })),
  };
}

const CreateDraftBodySchema = z.object({
  type: z.enum(PROJECT_TYPES, {
    message: "Choose Project, Research paper, Thesis, or Assignment.",
  }),
});

const ProjectIdSchema = z.string().trim().min(1).max(120);

async function requireApiSession(request: Request, deps: HttpAuthDeps) {
  const isProd = deps.appEnv === "prod";
  const rawToken = readSessionTokenFromRequest(request, isProd);
  return getSessionFromToken(deps.db, rawToken, deps.nowFn);
}

async function readJsonBody(
  request: Request
): Promise<{ ok: true; data: unknown } | { ok: false }> {
  try {
    const data: unknown = await request.json();
    return { ok: true, data };
  } catch {
    return { ok: false };
  }
}

function handleWizardRouteError(err: unknown, routeName: string): Response {
  if (err instanceof WizardError) {
    return jsonNoStore({ ok: false, code: err.code, error: err.message }, err.status);
  }
  logEvent("error", `api_${routeName}_unhandled`, {
    data: { message: err instanceof Error ? err.message : String(err) },
  });
  return jsonNoStore({ ok: false, error: "An unexpected error occurred. Please try again." }, 500);
}

export async function handleCreateProjectDraft(
  request: Request,
  deps: HttpAuthDeps
): Promise<Response> {
  if (!isAllowedOrigin(request, deps.appUrl)) {
    return jsonNoStore({ ok: false, error: "Forbidden cross-origin request." }, 403);
  }

  const session = await requireApiSession(request, deps);
  if (!session) {
    return jsonNoStore({ ok: false, error: "Authentication required." }, 401);
  }

  const parsedBody = await readJsonBody(request);
  if (!parsedBody.ok) {
    return jsonNoStore({ ok: false, error: "Invalid JSON request body." }, 400);
  }

  const validated = CreateDraftBodySchema.safeParse(parsedBody.data);
  if (!validated.success) {
    return jsonNoStore(
      { ok: false, error: validated.error.issues[0]?.message ?? "Choose a valid work type." },
      400
    );
  }

  try {
    const now = (deps.nowFn ?? (() => new Date()))();
    const state = await createWizardDraftProject(
      deps.db,
      session.user.id,
      validated.data.type,
      now
    );
    return jsonNoStore({ ok: true, wizard: serializeWizardState(state) }, 201);
  } catch (err) {
    return handleWizardRouteError(err, "create_project_draft");
  }
}

export async function handleGetWizardState(
  request: Request,
  rawProjectId: string,
  deps: HttpAuthDeps
): Promise<Response> {
  const session = await requireApiSession(request, deps);
  if (!session) {
    return jsonNoStore({ ok: false, error: "Authentication required." }, 401);
  }

  const parsedId = ProjectIdSchema.safeParse(rawProjectId);
  if (!parsedId.success) {
    return jsonNoStore({ ok: false, error: "Invalid project ID." }, 400);
  }

  try {
    const state = await getWizardStateForUser(deps.db, session.user.id, parsedId.data);
    if (!state) {
      return jsonNoStore({ ok: false, error: "Project not found." }, 404);
    }
    return jsonNoStore({ ok: true, wizard: serializeWizardState(state) }, 200);
  } catch (err) {
    return handleWizardRouteError(err, "get_wizard_state");
  }
}

export async function handleSaveWizardStep(
  request: Request,
  rawProjectId: string,
  deps: HttpAuthDeps
): Promise<Response> {
  if (!isAllowedOrigin(request, deps.appUrl)) {
    return jsonNoStore({ ok: false, error: "Forbidden cross-origin request." }, 403);
  }

  const session = await requireApiSession(request, deps);
  if (!session) {
    return jsonNoStore({ ok: false, error: "Authentication required." }, 401);
  }

  const parsedId = ProjectIdSchema.safeParse(rawProjectId);
  if (!parsedId.success) {
    return jsonNoStore({ ok: false, error: "Invalid project ID." }, 400);
  }

  const parsedBody = await readJsonBody(request);
  if (!parsedBody.ok) {
    return jsonNoStore({ ok: false, error: "Invalid JSON request body." }, 400);
  }

  try {
    const now = (deps.nowFn ?? (() => new Date()))();
    const state = await saveWizardStepForUser(
      deps.db,
      session.user.id,
      parsedId.data,
      parsedBody.data,
      now
    );
    return jsonNoStore({ ok: true, wizard: serializeWizardState(state) }, 200);
  } catch (err) {
    return handleWizardRouteError(err, "save_wizard_step");
  }
}
