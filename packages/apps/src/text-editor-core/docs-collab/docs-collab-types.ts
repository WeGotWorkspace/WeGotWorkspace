import type { MutableRefObject } from "react";
import type { IndexeddbPersistence } from "y-indexeddb";
import type * as awarenessProtocol from "y-protocols/awareness";
import type * as Y from "yjs";
import type { DocsCollabAccess } from "./docs-collab-access";
import type { DocsCollabWireOperations } from "./docs-collab-wire";
import type { DocsRtcSession } from "./docs-rtc-session";

export type DocsCollabMeshPeer = { id: string; name: string };

export type DocsCollabPeerLinkState =
  "connected" | "connecting" | "server" | "failed" | "disconnected" | "closed";

export type DocsCollabMeshPeerStatus = DocsCollabMeshPeer & { link: DocsCollabPeerLinkState };

/**
 * Who the transport authenticated the sender as and what the server resolved
 * they may change. Absent means untrusted, which the update guard reads as
 * `read` — a sync message without it never reaches the document.
 */
export type DocsCollabSenderTrust = {
  user: string;
  access: DocsCollabAccess;
};

export type DocsCollabMeshMessage =
  | { type: "sync"; u: number[]; from?: string; trust?: DocsCollabSenderTrust }
  | { type: "awareness"; u: number[]; from?: string }
  /** Gossip discovery: a connected peer forwards newly joined room peers. */
  | { type: "peer-hint"; peers: DocsCollabMeshPeer[]; from?: string }
  | { type: "dc-open"; from: string }
  /** A data-channel send failed. The mesh should sync this peer again. */
  | { type: "resync"; from: string }
  /** The server refused the poll: read access is gone, leave the room. */
  | { type: "forbidden" }
  | { type: "link" };

export type DocsCollabTabSyncApi = {
  onLocalSync: (encoded: number[]) => void;
  onLocalAwareness: (encoded: number[]) => void;
  relayMeshMessage: (msg: DocsCollabMeshMessage) => void;
  publishMeshState: (state: import("./docs-collab-tab-sync").TabMeshStateSnapshot) => void;
  isMeshLeader: () => boolean;
};

export type DocsCollabUrls = {
  signalUrl: string;
  collabApiBaseUrl?: string;
  collabRtcUrl?: string;
  documentUrl: string;
  yjsUrl: string;
  room?: string;
  authToken?: string;
  authTokenUrl?: string;
  authUser?: string;
  authPassword?: string;
  documentSaveMethod?: "POST" | "PUT" | "PATCH";
  /** Notes: persist markdown via REST instead of `/files/collaboration`. */
  persistMarkdown?: (markdown: string, authToken?: string) => Promise<void>;
  loadDocumentMarkdown?: (authToken?: string) => Promise<string>;
  skipYjsSnapshot?: boolean;
  onPersistForbidden?: () => void;
  onReconnectConflict?: () => void;
};

export const DEFAULT_DOCS_COLLAB_URLS: DocsCollabUrls = {
  signalUrl: "/api/v1/rooms/f_ZG9jcy90ZXN0LXRvZ2V0aGVyLm1k/events",
  collabApiBaseUrl: "/api/v1/rooms",
  collabRtcUrl: "/api/v1/rooms/f_ZG9jcy90ZXN0LXRvZ2V0aGVyLm1k/configuration",
  documentUrl: "/api/v1/files/collaboration?path=docs%2Ftest-together.md",
  yjsUrl: "/api/v1/files/collaboration?path=docs%2Ftest-together.md&format=yjs",
  documentSaveMethod: "PUT",
  room: "docs/test-together.md",
};

export type DocsCollabSession = {
  ydoc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  /** `id` is a stable per-name author id used by track-changes (suggestion mode). */
  user: { name: string; color: string; id: string };
};

export type UseDocsCollabOptions = {
  userName: string;
  autoJoin?: boolean;
  urls?: DocsCollabUrls;
  wire?: DocsCollabWireOperations;
  /**
   * Markdown to seed an empty Y.Doc with on first open when the server has no
   * snapshot/markdown yet (e.g. Notes bodies seeded from the cached note body,
   * or offline first-open of a note never persisted to IndexedDB). Server and
   * IndexedDB content always take precedence over this fallback.
   */
  seedContent?: string;
};

export type DocsCollabSessionRefs = {
  meshRef: MutableRefObject<DocsRtcSession | null>;
  ydocRef: MutableRefObject<Y.Doc | null>;
  awarenessRef: MutableRefObject<awarenessProtocol.Awareness | null>;
  persistenceRef: MutableRefObject<IndexeddbPersistence | null>;
  pendingMarkdownRef: MutableRefObject<string>;
  seedDoneRef: MutableRefObject<boolean>;
  saveTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  seedTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  getMarkdownRef: MutableRefObject<(() => string) | null>;
  joinGenerationRef: MutableRefObject<number>;
  reconnectGenerationRef: MutableRefObject<number>;
  authTokenRef: MutableRefObject<string | undefined>;
  failedSinceRef: MutableRefObject<Map<string, number>>;
  saveFailedRef: MutableRefObject<boolean>;
  wireRef: MutableRefObject<DocsCollabWireOperations>;
  seedContentRef: MutableRefObject<string | undefined>;
  joinedRoomRef: MutableRefObject<string | null>;
  reconnectInFlightRef: MutableRefObject<boolean>;
  saveInFlightRef: MutableRefObject<boolean>;
  saveRetryMsRef: MutableRefObject<number>;
  nextSaveAttemptAtRef: MutableRefObject<number>;
  localDirtySinceLastSaveRef: MutableRefObject<boolean>;
  pendingServerSaveRef: MutableRefObject<boolean>;
  lastKnownMarkdownRef: MutableRefObject<string>;
  lastSuccessfulSaveSignatureRef: MutableRefObject<string | null>;
  sessionRef: MutableRefObject<DocsCollabSession | null>;
  tabSyncRef: MutableRefObject<DocsCollabTabSyncApi | null>;
};
