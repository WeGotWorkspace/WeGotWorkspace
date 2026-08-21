import type { JmapId } from "../core/types.js";

export type JmapFileNodeType = "file" | "directory";

/** draft-ietf-jmap-filenode-14 FilesRights. */
export type JmapFilesRights = {
  mayRead: boolean;
  mayAddChildren: boolean;
  mayRename: boolean;
  mayDelete: boolean;
  mayModifyContent: boolean;
  mayShare: boolean;
};

/**
 * Notes projection on `.md` files under `.notes` (chunk B).
 * `starred` is the caller's Drive star — never YAML.
 */
export type JmapFileNodeNote = {
  title: string;
  tags: string[];
  excerpt: string;
  notebook: string;
  archived: boolean;
  starred: boolean;
};

/** FileNode/set `note` patch — title/tags only; starred is not writable. */
export type JmapFileNodeNotePatch = {
  title?: string;
  tags?: string[];
};

/** FileNode object (draft-ietf-jmap-filenode-14 §3.2). */
export type JmapFileNode = {
  id: JmapId;
  parentId: JmapId | null;
  nodeType: JmapFileNodeType;
  blobId: string | null;
  name: string;
  size: number | null;
  type: string | null;
  created?: string;
  modified?: string;
  accessed?: string;
  changed?: string;
  myRights?: JmapFilesRights;
  note?: JmapFileNodeNote;
  [key: string]: unknown;
};

/** Honest subset advertised by FileNode/query. */
export type JmapFileNodeFilter = {
  isTopLevel?: boolean;
  parentId?: JmapId;
  ancestorId?: JmapId;
  nodeType?: JmapFileNodeType;
  name?: string;
  nameMatch?: string;
};

export type JmapFileNodeCreate = {
  parentId: JmapId;
  name: string;
  nodeType?: JmapFileNodeType;
  blobId?: string;
  size?: number;
  type?: string;
  note?: JmapFileNodeNotePatch;
};
