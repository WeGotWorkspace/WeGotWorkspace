import type { SaveAsMarkdownIo } from "@/docs-core/src/docx-import/save-docx-as-markdown";
import { createDriveNodeKeepingBoth } from "@/lib/api/wgw/drive-create-keep-both";
import {
  downloadFileNodeBlob,
  driveJmapSession,
  fetchDriveUser,
  uploadJmapBlob,
} from "@/lib/api/wgw/drive-jmap";
import { normalizeApiVirtualPath } from "@/lib/files/api-path";
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
    async createEmptyDoc(parentPath, name) {
      const created = await createDriveNodeKeepingBoth(
        normalizeApiVirtualPath(parentPath),
        new File([], name, { type: MARKDOWN_TYPE }),
        { signal },
      );
      if (!created.nodeId) throw new Error("FileNode/set did not return the new Doc's id.");
      return { name: created.name, nodeId: created.nodeId };
    },
    async uploadImage(docPath, nodeId, image) {
      return (await uploadDocAttachmentImage(docPath, image, { signal, docNodeId: nodeId })).nodeId;
    },
    async writeDoc(nodeId, markdown) {
      // Write onto the node we created, by id: never onto a file that took the name since.
      const session = await driveJmapSession();
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
    async removeDoc(docPath, nodeId) {
      const session = await driveJmapSession();
      await session.fileNodes.setFileNodes(
        { accountId: session.accountId, destroy: [nodeId] },
        { signal },
      );
      session.cache.forgetSubtree(normalizeApiVirtualPath(docPath));
    },
  };
}
