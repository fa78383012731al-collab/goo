import { db, projectsTable, foldersTable, userSessionsTable, uploadedFilesTable } from "@workspace/db";
import { eq, desc, sql, sum, count } from "drizzle-orm";
import type { Project, Folder } from "@workspace/db";

export type { Project, Folder };

export type BotState =
  | "idle"
  | "waiting_project_name_adaa"
  | "waiting_project_name_injaz"
  | "waiting_subfolder_name"
  | "in_project";

export async function getSession(userId: number) {
  const rows = await db
    .select()
    .from(userSessionsTable)
    .where(eq(userSessionsTable.userId, String(userId)));
  return rows[0] ?? null;
}

export async function upsertSession(
  userId: number,
  data: {
    state?: BotState;
    currentProjectId?: number | null;
    currentFolderId?: number | null;
    stateData?: string | null;
  }
) {
  await db
    .insert(userSessionsTable)
    .values({
      userId: String(userId),
      state: data.state ?? "idle",
      currentProjectId: data.currentProjectId ?? null,
      currentFolderId: data.currentFolderId ?? null,
      stateData: data.stateData ?? null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: userSessionsTable.userId,
      set: {
        ...(data.state !== undefined ? { state: data.state } : {}),
        ...(data.currentProjectId !== undefined ? { currentProjectId: data.currentProjectId } : {}),
        ...(data.currentFolderId !== undefined ? { currentFolderId: data.currentFolderId } : {}),
        ...(data.stateData !== undefined ? { stateData: data.stateData } : {}),
        updatedAt: new Date(),
      },
    });
}

export async function createProject(
  name: string,
  type: "adaa" | "injaz",
  mainFolderId: string,
  mainFolderLink: string
): Promise<Project> {
  const rows = await db
    .insert(projectsTable)
    .values({ name, type, mainFolderId, mainFolderLink })
    .returning();
  return rows[0];
}

export async function createFolder(
  projectId: number,
  name: string,
  driveFolderId: string,
  driveFolderLink: string,
  orderIndex = 0
): Promise<Folder> {
  const rows = await db
    .insert(foldersTable)
    .values({ projectId, name, driveFolderId, driveFolderLink, orderIndex })
    .returning();
  return rows[0];
}

export async function getProject(id: number): Promise<Project | null> {
  const rows = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, id));
  return rows[0] ?? null;
}

export async function getProjectFolders(projectId: number): Promise<Folder[]> {
  return db
    .select()
    .from(foldersTable)
    .where(eq(foldersTable.projectId, projectId))
    .orderBy(foldersTable.orderIndex, foldersTable.id);
}

export async function getFolder(id: number): Promise<Folder | null> {
  const rows = await db
    .select()
    .from(foldersTable)
    .where(eq(foldersTable.id, id));
  return rows[0] ?? null;
}

export async function listProjects(): Promise<Project[]> {
  return db
    .select()
    .from(projectsTable)
    .orderBy(desc(projectsTable.createdAt));
}

export async function recordUpload(
  projectId: number,
  folderId: number,
  fileName: string,
  mimeType: string,
  sizeBytes: number
): Promise<void> {
  await db.insert(uploadedFilesTable).values({
    projectId,
    folderId,
    fileName,
    mimeType,
    sizeBytes,
  });
}

export interface ProjectStats {
  totalFiles: number;
  totalBytes: number;
  folderStats: { folderName: string; fileCount: number; totalBytes: number }[];
  lastUploadAt: Date | null;
}

export async function getProjectStats(projectId: number): Promise<ProjectStats> {
  const overall = await db
    .select({
      totalFiles: count(uploadedFilesTable.id),
      totalBytes: sum(uploadedFilesTable.sizeBytes),
    })
    .from(uploadedFilesTable)
    .where(eq(uploadedFilesTable.projectId, projectId));

  const byFolder = await db
    .select({
      folderName: foldersTable.name,
      fileCount: count(uploadedFilesTable.id),
      totalBytes: sum(uploadedFilesTable.sizeBytes),
    })
    .from(uploadedFilesTable)
    .innerJoin(foldersTable, eq(uploadedFilesTable.folderId, foldersTable.id))
    .where(eq(uploadedFilesTable.projectId, projectId))
    .groupBy(foldersTable.id, foldersTable.name, foldersTable.orderIndex)
    .orderBy(foldersTable.orderIndex, foldersTable.id);

  const lastUploadRow = await db
    .select({ uploadedAt: uploadedFilesTable.uploadedAt })
    .from(uploadedFilesTable)
    .where(eq(uploadedFilesTable.projectId, projectId))
    .orderBy(desc(uploadedFilesTable.uploadedAt))
    .limit(1);

  return {
    totalFiles: Number(overall[0]?.totalFiles ?? 0),
    totalBytes: Number(overall[0]?.totalBytes ?? 0),
    folderStats: byFolder.map((r) => ({
      folderName: r.folderName,
      fileCount: Number(r.fileCount),
      totalBytes: Number(r.totalBytes ?? 0),
    })),
    lastUploadAt: lastUploadRow[0]?.uploadedAt ?? null,
  };
}

export async function getGlobalStats(): Promise<{ totalProjects: number; totalFiles: number; totalBytes: number }> {
  const projects = await db.select({ cnt: count(projectsTable.id) }).from(projectsTable);
  const files = await db
    .select({
      totalFiles: count(uploadedFilesTable.id),
      totalBytes: sum(uploadedFilesTable.sizeBytes),
    })
    .from(uploadedFilesTable);

  return {
    totalProjects: Number(projects[0]?.cnt ?? 0),
    totalFiles: Number(files[0]?.totalFiles ?? 0),
    totalBytes: Number(files[0]?.totalBytes ?? 0),
  };
}
