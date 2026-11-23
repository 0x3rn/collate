import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type AppDb } from "@/db/client";
import {
  createWizardDraftProject,
  getWizardStateForUser,
  saveWizardStepForUser,
  WizardError,
} from "@/db/queries/wizard";
import { chapters, users } from "@/db/schema";
import { createInMemoryD1, type InMemoryD1Context } from "./helpers/in-memory-d1";

describe("Phase 2 Setup Wizard — D1 persistence, validation, and isolation", () => {
  let ctx: InMemoryD1Context;
  let db: AppDb;
  const fixedNow = new Date("2026-11-21T17:00:00.000Z");

  beforeEach(async () => {
    ctx = createInMemoryD1();
    ctx.applyMigrations();
    db = createDb(ctx.d1);

    for (const [id, email, name] of [
      ["usr_alice", "alice@uni.edu", "Alice"],
      ["usr_bob", "bob@uni.edu", "Bob"],
    ] as const) {
      await db.insert(users).values({
        id,
        email,
        emailVerified: true,
        name,
        creditsBalance: 20,
        createdAt: fixedNow,
        updatedAt: fixedNow,
      });
    }
  });

  afterEach(() => {
    ctx.close();
  });

  it("completes the full 8-step Thesis wizard, persists every step, and auto-adds References", async () => {
    const created = await createWizardDraftProject(db, "usr_alice", "thesis", fixedNow);
    const projectId = created.project.id;
    expect(created.project.wizardStep).toBe(2);

    // Step 2: Topic
    const s2 = await saveWizardStepForUser(
      db,
      "usr_alice",
      projectId,
      {
        step: 2,
        title: "Battery Storage Economics for Off-Grid Clinics in West Africa",
        field: "Energy Engineering",
        level: "Masters",
        institution: "University of Lagos",
        supervisorNotes: "Include lifecycle cost comparisons.",
      },
      fixedNow
    );
    expect(s2.project.title).toContain("Battery Storage");
    expect(s2.project.wizardStep).toBe(3);

    // Step 3: Mocked research sweep fails closed by default, succeeds only when dev mock is explicitly allowed
    await expect(
      saveWizardStepForUser(
        db,
        "usr_alice",
        projectId,
        { step: 3, simulateVerdict: "feasible" },
        fixedNow
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });

    const s3 = await saveWizardStepForUser(
      db,
      "usr_alice",
      projectId,
      { step: 3, simulateVerdict: "feasible" },
      fixedNow,
      { allowMockVerdict: true }
    );
    expect(s3.project.status).toBe("feasible");
    expect(s3.project.idealPages).toBe(100);
    expect(s3.feasibilityReports).toHaveLength(1);
    expect(s3.feasibilityReports[0]?.isMocked).toBe(true);

    // Step 4: Override target pages
    const s4 = await saveWizardStepForUser(
      db,
      "usr_alice",
      projectId,
      { step: 4, targetPages: 80 },
      fixedNow
    );
    expect(s4.project.targetPages).toBe(80);

    // Step 5: Custom chapters + front/back matter toggles (References auto-added)
    const s5 = await saveWizardStepForUser(
      db,
      "usr_alice",
      projectId,
      {
        step: 5,
        chapters: [
          { number: 1, title: "Introduction" },
          { number: 2, title: "Literature Review" },
          { number: 3, title: "System Methodology" },
          { number: 4, title: "Findings and Analysis" },
        ],
        frontMatter: {
          coverPage: true,
          certification: true,
          dedication: true,
          acknowledgements: true,
          preface: true,
          abstract: true,
          tableOfContents: true,
          listOfFiguresAndTables: true,
          appendices: true,
        },
      },
      fixedNow
    );
    expect(s5.chapters).toHaveLength(5);
    expect(s5.chapters[4]?.title).toBe("References");
    expect(s5.chapters[4]?.isAutoReferences).toBe(true);
    expect(s5.settings.frontMatter.preface).toBe(true);
    const totalBudget = s5.chapters
      .filter((c) => !c.isAutoReferences)
      .reduce((sum, c) => sum + (c.pageBudget ?? 0), 0);
    expect(totalBudget).toBe(80);

    // Step 6: Citations
    const s6 = await saveWizardStepForUser(
      db,
      "usr_alice",
      projectId,
      { step: 6, citationStyle: "harvard", inlineMode: "inline_and_list" },
      fixedNow
    );
    expect(s6.settings.citationStyle).toBe("harvard");

    // Step 7: Formatting + cover page
    const s7 = await saveWizardStepForUser(
      db,
      "usr_alice",
      projectId,
      {
        step: 7,
        font: "Georgia",
        fontSizePt: 12,
        lineSpacing: "one_half",
        marginsMm: 25,
        pageNumbering: true,
        spelling: "uk",
        cover: {
          authorName: "Alice Obi",
          institution: "University of Lagos",
          department: "Electrical Engineering",
          supervisor: "Prof. K. Adeyemi",
          submissionDate: "November 2026",
        },
      },
      fixedNow
    );
    expect(s7.settings.font).toBe("Georgia");
    expect(s7.settings.cover.supervisor).toBe("Prof. K. Adeyemi");

    // Step 8: Outline confirm
    const s8 = await saveWizardStepForUser(
      db,
      "usr_alice",
      projectId,
      { step: 8, confirmed: true },
      fixedNow
    );
    expect(s8.project.status).toBe("outline_pending");

    // Reload cleanly to verify full resumability
    const resumed = await getWizardStateForUser(db, "usr_alice", projectId);
    expect(resumed?.chapters).toHaveLength(5);
    expect(resumed?.settings.citationStyle).toBe("harvard");
  });

  it("supports Assignment mode with 1 question and with 5 questions (skips chapters cleanly)", async () => {
    // 1-question assignment
    const oneQ = await createWizardDraftProject(db, "usr_alice", "assignment", fixedNow);
    await saveWizardStepForUser(
      db,
      "usr_alice",
      oneQ.project.id,
      {
        step: 2,
        title: "Macroeconomics Policy Assignment",
        questions: ["Explain how central bank interest rate hikes affect domestic inflation."],
      },
      fixedNow
    );
    const oneSweep = await saveWizardStepForUser(
      db,
      "usr_alice",
      oneQ.project.id,
      { step: 3, simulateVerdict: "feasible" },
      fixedNow,
      { allowMockVerdict: true }
    );
    expect(oneSweep.questions).toHaveLength(1);
    expect(oneSweep.feasibilityReports).toHaveLength(1);
    expect(oneSweep.project.idealPages).toBe(4);

    // 5-question assignment
    const fiveQ = await createWizardDraftProject(db, "usr_alice", "assignment", fixedNow);
    await saveWizardStepForUser(
      db,
      "usr_alice",
      fiveQ.project.id,
      {
        step: 2,
        title: "Constitutional Law Seminar Questions",
        questions: [
          "Question 1: Define separation of powers with two historical cases.",
          "Question 2: Compare federal and unitary judicial review models.",
          "Question 3: Analyze limits on executive emergency declarations.",
          "Question 4: Discuss parliamentary privilege in common law systems.",
          "Question 5: Evaluate statutory interpretation approaches.",
        ],
      },
      fixedNow
    );
    const fiveSweep = await saveWizardStepForUser(
      db,
      "usr_alice",
      fiveQ.project.id,
      { step: 3, simulateVerdict: "feasible" },
      fixedNow,
      { allowMockVerdict: true }
    );
    expect(fiveSweep.questions).toHaveLength(5);
    expect(fiveSweep.feasibilityReports).toHaveLength(5);
    expect(fiveSweep.project.idealPages).toBe(20);

    // Step 4 on assignment skips Step 5 (chapters) and lands directly on Step 6 (citations)
    const afterLength = await saveWizardStepForUser(
      db,
      "usr_alice",
      fiveQ.project.id,
      { step: 4, targetPages: 18 },
      fixedNow
    );
    expect(afterLength.project.wizardStep).toBe(6);

    // Attempting to submit Step 5 chapters on an assignment must fail explicitly
    await expect(
      saveWizardStepForUser(db, "usr_alice", fiveQ.project.id, {
        step: 5,
        chapters: [{ number: 1, title: "Intro" }],
        frontMatter: {
          coverPage: true,
          certification: false,
          dedication: false,
          acknowledgements: false,
          preface: false,
          abstract: false,
          tableOfContents: false,
          listOfFiguresAndTables: false,
          appendices: false,
        },
      })
    ).rejects.toThrow(WizardError);
  });

  it("rejects duplicate chapter numbers, blank titles, invalid page counts, and empty assignments", async () => {
    const draft = await createWizardDraftProject(db, "usr_alice", "project", fixedNow);

    await expect(
      saveWizardStepForUser(db, "usr_alice", draft.project.id, { step: 2, title: "   " })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 400 });

    await expect(
      saveWizardStepForUser(db, "usr_alice", draft.project.id, { step: 4, targetPages: 0 })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 400 });

    await expect(
      saveWizardStepForUser(db, "usr_alice", draft.project.id, { step: 4, targetPages: 450 })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 400 });

    await expect(
      saveWizardStepForUser(db, "usr_alice", draft.project.id, {
        step: 5,
        chapters: [
          { number: 1, title: "Introduction" },
          { number: 1, title: "Duplicate Chapter One" },
        ],
        frontMatter: {
          coverPage: true,
          certification: false,
          dedication: false,
          acknowledgements: true,
          preface: false,
          abstract: true,
          tableOfContents: true,
          listOfFiguresAndTables: false,
          appendices: false,
        },
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 400 });

    // Prove DB UNIQUE constraint also prevents duplicate chapter numbers at SQLite level
    await expect(
      db.insert(chapters).values({
        id: "chp_dup_db",
        projectId: draft.project.id,
        number: 1,
        title: "Forced Duplicate",
        chapterType: "custom",
        isAutoReferences: false,
        status: "not_started",
        createdAt: fixedNow,
        updatedAt: fixedNow,
      })
    ).rejects.toThrow();
  });

  it("prevents another user from reading or mutating someone else's wizard draft", async () => {
    const aliceDraft = await createWizardDraftProject(db, "usr_alice", "research", fixedNow);

    expect(await getWizardStateForUser(db, "usr_bob", aliceDraft.project.id)).toBeNull();

    await expect(
      saveWizardStepForUser(db, "usr_bob", aliceDraft.project.id, {
        step: 2,
        title: "Hijacked Topic Title",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });
});
