import { isDocsCollabEditablePath } from "@/docs-core/src/docs-collab-text-files";
import { readMeta, writeMeta } from "@/lib/offline/core/meta-store";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import {
  normalizeDocsAvailabilityPath,
  removeDocsAvailability,
} from "@/lib/offline/docs/docs-availability-store";
import { driveEntriesTable } from "@/lib/offline/drive/drive-schema";
import {
  clearDocsCollabOfflinePersistence,
  hasDocsCollabPendingServerSave,
} from "@/text-editor-core/docs-collab/docs-collab-persistence";

/** Paths kept because `PENDING_SERVER_SAVE_KEY` is set. */
export const KEPT_UNSAVED_DOCUMENTS_META_KEY = "drive:kept-unsaved-documents";

/**
 * Keep the drive row, pin, and collab database when the document still has
 * unsaved local work. Otherwise drop the pin and the database. The caller
 * deletes the drive row only after `"dropped"`.
 */
export async function retainOrDropLocalDocument(
  username: string,
  apiPath: string,
): Promise<"kept" | "dropped"> {
  const id = normalizeDocsAvailabilityPath(apiPath);
  if (await documentHasPendingServerSave(id)) {
    await rememberKeptUnsavedDocuments(username, [id]);
    return "kept";
  }
  if (isDocsCollabEditablePath(id)) {
    await removeDocsAvailability(username, id);
    await dropCollabDatabase(id);
  }
  return "dropped";
}

export async function listKeptUnsavedDocumentPaths(username: string): Promise<string[]> {
  const raw = await readMeta(username, KEPT_UNSAVED_DOCUMENTS_META_KEY);
  const stored = parsePathList(raw);
  const stillKept: string[] = [];
  for (const path of stored) {
    if (await documentHasPendingServerSave(path)) stillKept.push(path);
  }
  if (stillKept.length !== stored.length) {
    await writeKeptUnsavedDocuments(username, stillKept);
  }
  return stillKept;
}

export async function documentHasPendingServerSave(apiPath: string): Promise<boolean> {
  return hasDocsCollabPendingServerSave(apiPath);
}

export async function deleteDriveEntryByPath(username: string, apiPath: string): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  await driveEntriesTable(db).delete(normalizeDocsAvailabilityPath(apiPath));
}

async function rememberKeptUnsavedDocuments(
  username: string,
  paths: readonly string[],
): Promise<void> {
  const existing = parsePathList(await readMeta(username, KEPT_UNSAVED_DOCUMENTS_META_KEY));
  const merged = [...new Set([...existing, ...paths])];
  await writeKeptUnsavedDocuments(username, merged);
}

async function writeKeptUnsavedDocuments(
  username: string,
  paths: readonly string[],
): Promise<void> {
  await writeMeta(username, KEPT_UNSAVED_DOCUMENTS_META_KEY, JSON.stringify(paths));
}

function parsePathList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && item.length > 0);
  } catch {
    return [];
  }
}

async function dropCollabDatabase(apiPath: string): Promise<void> {
  await clearDocsCollabOfflinePersistence(apiPath);
}
