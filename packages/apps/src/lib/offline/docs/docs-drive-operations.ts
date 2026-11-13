import { createWgwDriveOperations } from "@/lib/api/wgw/drive";
import { parentAndName } from "@/lib/files/api-path";
import type { DocsAPIOperations } from "@/lib/models/docs-types";

/** Live Files API operations for Docs (load/save/rename whole files). */
export function createWgwDocsDriveOperations(): DocsAPIOperations {
  const drive = createWgwDriveOperations("/");
  return {
    async loadFile(apiPath, opts) {
      const blob = await drive.readFileBlob(apiPath, opts);
      return blob.text();
    },
    async saveFile(apiPath, content, opts) {
      const { destination, from } = parentAndName(apiPath);
      const isPlainText = from.toLowerCase().endsWith(".txt");
      const mime = isPlainText ? "text/plain;charset=utf-8" : "text/markdown;charset=utf-8";
      const blob = new Blob([content], { type: mime });
      const file = new File([blob], from, {
        type: isPlainText ? "text/plain" : "text/markdown",
        lastModified: Date.now(),
      });
      await drive.checkUploadReady(opts);
      await drive.uploadFiles({ cwd: destination, files: [file] }, opts);
    },
    async renameFile(apiPath, newName, opts) {
      const { destination } = parentAndName(apiPath);
      await drive.renameItem({ destination, from: apiPath, to: newName }, opts);
      return destination === "/" ? `/${newName}` : `${destination}/${newName}`;
    },
  };
}
