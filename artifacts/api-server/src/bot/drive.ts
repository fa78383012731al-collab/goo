import { google } from "googleapis";
import { Readable } from "stream";
import { logger } from "../lib/logger";
import { getAuthorizedClient } from "./oauth";

async function getUserDriveClient() {
  const client = await getAuthorizedClient();
  if (!client) return null;
  return google.drive({ version: "v3", auth: client });
}

export async function createFolder(
  name: string,
  parentId?: string
): Promise<{ id: string; link: string }> {
  const drive = await getUserDriveClient();
  if (!drive) {
    throw new Error("Google account not connected. Please authorize first via /api/auth/google");
  }

  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      ...(parentId ? { parents: [parentId] } : {}),
    },
    fields: "id, webViewLink",
  });

  const folderId = res.data.id!;
  const webViewLink = res.data.webViewLink!;

  await drive.permissions.create({
    fileId: folderId,
    requestBody: { role: "reader", type: "anyone" },
  });

  logger.info({ folderId, name }, "Created Drive folder via user OAuth");
  return { id: folderId, link: webViewLink };
}

export async function uploadFile(
  fileName: string,
  mimeType: string,
  fileBuffer: Buffer,
  parentId: string
): Promise<{ id: string; link: string }> {
  const drive = await getUserDriveClient();
  if (!drive) {
    throw new Error("Google account not connected. Please authorize first.");
  }

  const stream = Readable.from(fileBuffer);

  const res = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [parentId],
    },
    media: { mimeType, body: stream },
    fields: "id, webViewLink",
  });

  const fileId = res.data.id!;
  const webViewLink = res.data.webViewLink!;

  logger.info({ fileId, fileName }, "Uploaded file to Drive via user OAuth");
  return { id: fileId, link: webViewLink };
}
