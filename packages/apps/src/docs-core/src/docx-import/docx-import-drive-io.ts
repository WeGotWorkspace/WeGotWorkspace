import type { SaveAsMarkdownIo } from "@/docs-core/src/docx-import/save-docx-as-markdown";
import { createDriveFileKeepingBoth } from "@/lib/api/wgw/drive-create-keep-both";
import {
  destroyFileNodes,
  downloadFileNodeBlob,
  driveJmapSession,
  fetchDriveUser,
  resolveFileNodeId,
  uploadJmapBlob,
} from "@/lib/api/wgw/drive-jmap";
import { normalizeApiVirtualPath, parentAndName } from "@/lib/files/api-path";
import { uploadDocAttachmentImage } from "@/text-editor-core/docs-collab/docs-image-upload";

const MARKDOWN_TYPE = "text/markdown";

/** Save as Markdown on the signed-in user's Drive (JMAP FileNode helpers). */
export function createDocxImportDriveIo(signal?: AbortSignal): SaveAsMarkdownIo {
  return {
    async readSource(apiPath) {
      const session = await driveJmapSession();
      const user = await fetchDriveUser({ signal });
      const path = normalizeApiVirtualPath(apiPath);
      const blob = await downloadFileNodeBlob(session, path, user.username, signal);
      return new Uint8Array(await blob.arrayBuffer());
    },
    createEmptyDoc(parentPath, name) {
      return createDriveFileKeepingBoth(
        normalizeApiVirtualPath(parentPath),
        new File([], name, { type: MARKDOWN_TYPE }),
        { signal },
      );
    },
    async uploadImage(docPath, image) {
      return (await uploadDocAttachmentImage(docPath, image, { signal })).nodeId;
    },
    async writeDoc(docPath, markdown) {
      // Write onto the node we created, by id: never onto a file that took the name since.
      const session = await driveJmapSession();
      const user = await fetchDriveUser({ signal });
      const nodeId = await resolveFileNodeId(
        session,
        normalizeApiVirtualPath(docPath),
        user.username,
        signal,
      );
      const blobId = await uploadJmapBlob(
        session,
        new Blob([markdown], { type: MARKDOWN_TYPE }),
        MARKDOWN_TYPE,
        signal,
      );
      await session.fileNodes.setFileNodes(
        { accountId: session.accountId, update: { [nodeId]: { blobId } } },
        { signal },
      );
    },
    async removeDoc(docPath) {
      const path = normalizeApiVirtualPath(docPath);
      await destroyFileNodes([path], { refreshState: false }, parentAndName(path).destination);
    },
  };
}
