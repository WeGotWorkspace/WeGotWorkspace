import type { WorkspaceSession } from "@/lib/workspace/workspace-session";

export type SpreadsheetDocument = {
  apiPath: string;
  fileName: string;
  content: string;
};

export type SpreadsheetUIData = {
  document: SpreadsheetDocument | null;
};

export type SpreadsheetAppBootstrap = {
  session: WorkspaceSession;
  data: SpreadsheetUIData;
};

export type SpreadsheetAPIOperations = {
  loadFile: (apiPath: string, opts?: { signal?: AbortSignal }) => Promise<string>;
  saveFile: (apiPath: string, content: string, opts?: { signal?: AbortSignal }) => Promise<void>;
  renameFile: (
    apiPath: string,
    newName: string,
    opts?: { signal?: AbortSignal },
  ) => Promise<string>;
};
