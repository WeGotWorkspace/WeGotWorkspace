import { canBrowserPreviewImage, extensionFromFileName } from "@/drive-core/src/drive-file-utils";
import { normalizeApiVirtualPath, parentAndName } from "@/lib/files/api-path";
import {
  driveJmapSession,
  fetchDriveUser,
  resolveFileNodeId,
  uploadJmapBlob,
} from "@/lib/api/wgw/drive-jmap";
import { JmapSetItemError } from "@/lib/jmap-client";

const ATTACHMENTS_DIR = ".attachments";

export function drivePrincipalPrefix(apiPath: string): string | null {
  const match = normalizeApiVirtualPath(apiPath).match(/^\/(users|groups)\/[^/]+/);
  return match ? match[0] : null;
}

export function docAttachmentsFolderPath(docApiPath: string, docNodeId: string): string | null {
  const prefix = drivePrincipalPrefix(docApiPath);
  if (!prefix) return null;
  return `${prefix}/${ATTACHMENTS_DIR}/${docNodeId}`;
}

export function imageExtensionForFile(file: File): string {
  const fromName = extensionFromFileName(file.name);
  if (fromName) return fromName;
  const mime = file.type.toLowerCase();
  if (mime === "image/jpeg") return "jpg";
  if (mime.startsWith("image/") && mime !== "image/*") {
    return mime.slice("image/".length).replace("+xml", "");
  }
  return "png";
}

export function isDocsImageFile(file: File): boolean {
  if (!file.type.startsWith("image/")) return false;
  const name = file.name?.trim();
  if (!name || !name.includes(".")) return true;
  return canBrowserPreviewImage(name);
}

async function ensureDirectory(
  path: string,
  username: string,
  signal?: AbortSignal,
): Promise<string> {
  const session = await driveJmapSession();
  try {
    return await resolveFileNodeId(session, path, username, signal);
  } catch {
    const { destination, from } = parentAndName(path);
    const parentId = await resolveFileNodeId(session, destination, username, signal);
    try {
      const created = await session.fileNodes.setFileNodes(
        { accountId: session.accountId, create: { d0: { parentId, name: from } } },
        { signal },
      );
      const node = created.created?.d0;
      if (node?.id) {
        session.cache.remember(path, {
          ...node,
          id: node.id,
          parentId: node.parentId ?? parentId,
          nodeType: node.nodeType ?? "directory",
          blobId: node.blobId ?? null,
          name: node.name ?? from,
          size: node.size ?? null,
          type: node.type ?? null,
        });
        return node.id;
      }
    } catch (error) {
      if (!(error instanceof JmapSetItemError && error.setError.type === "alreadyExists")) {
        throw error;
      }
    }
    return resolveFileNodeId(session, path, username, signal);
  }
}

export async function resolveDriveFileNodeId(
  apiPath: string,
  opts?: { signal?: AbortSignal },
): Promise<string> {
  const session = await driveJmapSession();
  const user = await fetchDriveUser(opts);
  return resolveFileNodeId(session, apiPath, user.username, opts?.signal);
}

/**
 * Hidden image folder for one note (#1623): `/{principal}/.attachments/note-{uid}`.
 * The principal is the group for a group notebook, else the importer. Not a
 * Doc folder, so the server does not apply Doc ACL inheritance to it.
 */
export function noteAttachmentsFolderPath(principalPrefix: string, noteId: string): string | null {
  const prefix = drivePrincipalPrefix(principalPrefix);
  const id = noteId.trim().toLowerCase();
  if (!prefix || !/^[0-9a-z-]+$/.test(id)) return null;
  return `${prefix}/${ATTACHMENTS_DIR}/note-${id}`;
}

/**
 * Upload one image into a hidden `.attachments` subfolder and name it
 * `{nodeId}.{ext}`. Shared by Docs and Notes; the caller picks the folder.
 */
export async function uploadHiddenAttachmentImage(
  folderPath: string,
  file: File,
  opts?: { signal?: AbortSignal; username?: string },
): Promise<{ nodeId: string; alt: string }> {
  if (!isDocsImageFile(file)) {
    throw new Error("Only browser-previewable images can be uploaded.");
  }
  const folder = normalizeApiVirtualPath(folderPath);
  const prefix = drivePrincipalPrefix(folder);
  if (!prefix || !folder.startsWith(`${prefix}/${ATTACHMENTS_DIR}/`)) {
    throw new Error("Attachment folder must be under a drive principal's .attachments.");
  }
  const session = await driveJmapSession();
  const username = opts?.username ?? (await fetchDriveUser(opts)).username;
  await ensureDirectory(`${prefix}/${ATTACHMENTS_DIR}`, username, opts?.signal);
  const parentId = await ensureDirectory(folder, username, opts?.signal);

  if (file.size > session.maxSizeUpload) {
    throw new Error(`File "${file.name}" exceeds maxSizeUpload.`);
  }
  const ext = imageExtensionForFile(file);
  const blobId = await uploadJmapBlob(
    session,
    file,
    file.type || "application/octet-stream",
    opts?.signal,
  );
  const created = await session.fileNodes.setFileNodes(
    {
      accountId: session.accountId,
      create: { f0: { parentId, name: `upload.${ext}`, blobId } },
    },
    { signal: opts?.signal },
  );
  const node = created.created?.f0;
  if (!node?.id) {
    throw new Error("FileNode/set did not return a created image id.");
  }
  const finalName = `${node.id}.${ext}`;
  try {
    await session.fileNodes.setFileNodes(
      { accountId: session.accountId, update: { [node.id]: { name: finalName } } },
      { signal: opts?.signal },
    );
  } catch {
    // Id-stable `drive:fn-` still resolves if rename is skipped.
  }
  const alt = file.name.replace(/\.[^.]+$/, "") || file.name;
  return { nodeId: node.id, alt };
}

export async function uploadDocAttachmentImage(
  docApiPath: string,
  file: File,
  opts?: { signal?: AbortSignal },
): Promise<{ nodeId: string; alt: string }> {
  if (!isDocsImageFile(file)) {
    throw new Error("Only browser-previewable images can be uploaded.");
  }
  const session = await driveJmapSession();
  const user = await fetchDriveUser(opts);
  const docPath = normalizeApiVirtualPath(docApiPath);
  const docNodeId = await resolveFileNodeId(session, docPath, user.username, opts?.signal);
  const folderPath = docAttachmentsFolderPath(docPath, docNodeId);
  if (!folderPath) {
    throw new Error("Document path has no drive principal prefix.");
  }
  return uploadHiddenAttachmentImage(folderPath, file, { ...opts, username: user.username });
}

/** Upload an image for a note into its hidden folder (see {@link noteAttachmentsFolderPath}). */
export async function uploadNoteAttachmentImage(
  target: { groupSlug?: string | null },
  noteId: string,
  file: File,
  opts?: { signal?: AbortSignal },
): Promise<{ nodeId: string; alt: string }> {
  const user = await fetchDriveUser(opts);
  const slug = target.groupSlug?.trim();
  const principal = slug ? `/groups/${slug}` : `/users/${user.username}`;
  const folderPath = noteAttachmentsFolderPath(principal, noteId);
  if (!folderPath) {
    throw new Error("Note has no attachment folder.");
  }
  return uploadHiddenAttachmentImage(folderPath, file, { ...opts, username: user.username });
}
