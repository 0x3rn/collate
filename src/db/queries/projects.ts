import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { AppDb } from "../client";
import { PROJECT_TYPES, projects, type ProjectRecord } from "../schema";

export const CreateProjectInputSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  type: z.enum(PROJECT_TYPES),
  title: z.string().trim().min(1).max(300),
  level: z.string().trim().max(100).optional(),
  field: z.string().trim().max(150).optional(),
  institution: z.string().trim().max(200).optional(),
  targetPages: z.number().int().positive().max(500).optional(),
  now: z.date().optional(),
});

export type CreateProjectInput = z.infer<typeof CreateProjectInputSchema>;

/**
 * Every project query requires an authenticated userId to enforce
 * resource-level ownership isolation at the persistence boundary.
 */
export async function listProjectsForUser(db: AppDb, userId: string): Promise<ProjectRecord[]> {
  if (!userId.trim()) {
    throw new Error("userId is required to list projects");
  }

  return db
    .select()
    .from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(desc(projects.createdAt));
}

export async function getProjectForUser(
  db: AppDb,
  userId: string,
  projectId: string
): Promise<ProjectRecord | null> {
  if (!userId.trim() || !projectId.trim()) {
    return null;
  }

  const rows = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);

  return rows[0] ?? null;
}

export async function createProjectForUser(
  db: AppDb,
  rawInput: CreateProjectInput
): Promise<ProjectRecord> {
  const input = CreateProjectInputSchema.parse(rawInput);
  const timestamp = input.now ?? new Date();

  const [created] = await db
    .insert(projects)
    .values({
      id: input.id,
      userId: input.userId,
      type: input.type,
      title: input.title,
      level: input.level ?? null,
      field: input.field ?? null,
      institution: input.institution ?? null,
      status: "draft",
      targetPages: input.targetPages ?? null,
      idealPages: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .returning();

  if (!created) {
    throw new Error("Failed to insert project record");
  }

  return created;
}
