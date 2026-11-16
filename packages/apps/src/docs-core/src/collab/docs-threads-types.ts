export type DocsFileThreadKind = "comment" | "suggestion";

export type DocsFileThreadAuthor = {
  id: string;
  name: string;
};

export type DocsFileThreadMessage = {
  id: string;
  body: string;
  createdAt: string;
  author: DocsFileThreadAuthor;
};

export type DocsFileThreadReaction = {
  emoji: string;
  userIds: string[];
};

export type DocsFileThread = {
  id: string;
  kind: DocsFileThreadKind;
  path: string;
  changeId: string | null;
  anchorText: string;
  anchorFrom: number | null;
  anchorTo: number | null;
  anchorOccurrence: number | null;
  createdAt: string;
  createdBy: DocsFileThreadAuthor;
  resolved: boolean;
  archived: boolean;
  messages: DocsFileThreadMessage[];
  reactions: DocsFileThreadReaction[];
};

export type DocsFileThreadCreate = {
  id: string;
  kind: DocsFileThreadKind;
  body: string;
  changeId?: string | null;
  anchorText?: string;
  anchorFrom?: number;
  anchorTo?: number;
  anchorOccurrence?: number;
};

export type DocsFileThreadPatch = {
  resolved?: boolean;
  archived?: boolean;
  changeId?: string;
  anchorText?: string;
  anchorFrom?: number;
  anchorTo?: number;
};

export type DocsFileThreadChanges = {
  oldState: string;
  newState: string;
  created: string[];
  updated: string[];
  destroyed: string[];
  hasMoreChanges: boolean;
};

export type DocsThreadsClient = {
  list: (path: string) => Promise<DocsFileThread[]>;
  create: (path: string, input: DocsFileThreadCreate) => Promise<DocsFileThread>;
  reply: (
    path: string,
    threadId: string,
    input: { id: string; body: string },
  ) => Promise<DocsFileThread>;
  react: (path: string, threadId: string, emoji: string) => Promise<DocsFileThread>;
  patch: (path: string, threadId: string, patch: DocsFileThreadPatch) => Promise<DocsFileThread>;
  changes: (path: string, since?: string | null) => Promise<DocsFileThreadChanges>;
};

export type DocsThreadsSnapshotClient = DocsThreadsClient & {
  snapshot: () => DocsFileThread[];
};

export function isDocsThreadsSnapshotClient(
  client: DocsThreadsClient,
): client is DocsThreadsSnapshotClient {
  return typeof (client as DocsThreadsSnapshotClient).snapshot === "function";
}

export function threadsQuery(path: string): string {
  return `path=${encodeURIComponent(path)}`;
}
