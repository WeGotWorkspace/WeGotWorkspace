import type { WorkspaceSession } from "@/lib/workspace/workspace-session";

export type DocsDocument = {
  apiPath: string;
  fileName: string;
  content: string;
};

export type DocsUIData = {
  document: DocsDocument | null;
};

export type DocsAppBootstrap = {
  session: WorkspaceSession;
  data: DocsUIData;
};

export type DocsAPIOperations = {
  loadFile: (apiPath: string, opts?: { signal?: AbortSignal }) => Promise<string>;
  saveFile: (apiPath: string, content: string, opts?: { signal?: AbortSignal }) => Promise<void>;
  renameFile: (
    apiPath: string,
    newName: string,
    opts?: { signal?: AbortSignal },
  ) => Promise<string>;
};
