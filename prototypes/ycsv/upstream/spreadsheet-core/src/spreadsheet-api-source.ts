import { createWorkspaceSource } from "@/lib/api/create-workspace-source";
import { wgwFetchPrincipal, wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import { createWgwDriveOperations } from "@/lib/api/wgw/drive";
import { parentAndName } from "@/lib/files/api-path";
import { createSpreadsheetAppBootstrap } from "@/lib/api/mock/spreadsheet-bootstrap";
import type {
  SpreadsheetAPIOperations,
  SpreadsheetAppBootstrap,
} from "@/spreadsheet-core/src/spreadsheet-types";

export type SpreadsheetApiSource = {
  loadBootstrap: () => Promise<SpreadsheetAppBootstrap>;
  createOperations: () => SpreadsheetAPIOperations | undefined;
};

function createWgwSpreadsheetOperations(): SpreadsheetAPIOperations {
  const drive = createWgwDriveOperations("/");
  return {
    async loadFile(apiPath, opts) {
      const blob = await drive.readFileBlob(apiPath, opts);
      return blob.text();
    },
    async saveFile(apiPath, content, opts) {
      const { destination, from } = parentAndName(apiPath);
      const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
      const file = new File([blob], from, { type: "text/plain", lastModified: Date.now() });
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

async function fetchSpreadsheetLiveBootstrap(): Promise<SpreadsheetAppBootstrap> {
  const session = await wgwFetchPrincipal();
  return { session, data: { document: null } };
}

export function createWgwSpreadsheetApiSource(): SpreadsheetApiSource {
  return {
    loadBootstrap: fetchSpreadsheetLiveBootstrap,
    createOperations: () => createWgwSpreadsheetOperations(),
  };
}

export function createDefaultSpreadsheetApiSource(): SpreadsheetApiSource {
  return createWorkspaceSource<SpreadsheetApiSource>({
    isLive: wgwLiveApiEnabled(),
    createMockSource: () => ({
      loadBootstrap: () => Promise.resolve(createSpreadsheetAppBootstrap()),
      createOperations: () => undefined,
    }),
    createLiveSource: createWgwSpreadsheetApiSource,
  });
}
