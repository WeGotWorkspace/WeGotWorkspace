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
  const attachmentsRoot = `${drivePrincipalPrefix(docPath)}/${ATTACHMENTS_DIR}`;
  await ensureDirectory(attachmentsRoot, user.username, opts?.signal);
  const parentId = await ensureDirectory(folderPath, user.username, opts?.signal);

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
