import { pgTable, serial, text, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";

export const projectTypeEnum = pgEnum("project_type", ["adaa", "injaz"]);

export const projectsTable = pgTable("projects", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: projectTypeEnum("type").notNull(),
  mainFolderId: text("main_folder_id").notNull(),
  mainFolderLink: text("main_folder_link").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const foldersTable = pgTable("folders", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id),
  name: text("name").notNull(),
  driveFolderId: text("drive_folder_id").notNull(),
  driveFolderLink: text("drive_folder_link").notNull(),
  orderIndex: integer("order_index").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const userSessionsTable = pgTable("user_sessions", {
  userId: text("user_id").primaryKey(),
  currentProjectId: integer("current_project_id").references(() => projectsTable.id),
  currentFolderId: integer("current_folder_id").references(() => foldersTable.id),
  state: text("state").default("idle").notNull(),
  stateData: text("state_data"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const uploadedFilesTable = pgTable("uploaded_files", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id),
  folderId: integer("folder_id").notNull().references(() => foldersTable.id),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
});

export type Project = typeof projectsTable.$inferSelect;
export type InsertProject = typeof projectsTable.$inferInsert;
export type Folder = typeof foldersTable.$inferSelect;
export type InsertFolder = typeof foldersTable.$inferInsert;
export type UserSession = typeof userSessionsTable.$inferSelect;
export type UploadedFile = typeof uploadedFilesTable.$inferSelect;
