import type { MutableRefObject } from "react";
import type { IndexeddbPersistence } from "y-indexeddb";
import type * as awarenessProtocol from "y-protocols/awareness";
import type * as Y from "yjs";
import type { TextEditorContentFormat } from "@/text-editor-core/src/text-editor-content";
import type { DocsCollabAccess } from "./docs-collab-access";
import type { DocsCollabWireOperations } from "./docs-collab-wire";
import type { DocsRtcSession } from "./docs-rtc-session";

export type DocsCollabMeshPeer = { id: string; name: string };

export type DocsCollabPeerLinkState =
  "connected" | "connecting" | "failed" | "disconnected" | "closed";

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
  | { type: "sync"; u: Uint8Array; from?: string; trust?: DocsCollabSenderTrust }
  | { type: "awareness"; u: Uint8Array; from?: string }
  /** Gossip discovery: a connected peer forwards newly joined room peers. */
  | { type: "peer-hint"; peers: DocsCollabMeshPeer[]; from?: string }
  | { type: "dc-open"; from: string }
  /** A data-channel send failed. The mesh should sync this peer again. */
  | { type: "resync"; from: string }
  /** The server refused the poll: read access is gone, leave the room. */
  | { type: "forbidden" }
  | { type: "link" };

export type DocsCollabTabSyncApi = {
  onLocalSync: (encoded: Uint8Array) => void;
  onLocalAwareness: (encoded: Uint8Array) => void;
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
  /**
   * The room has no server id yet (an offline-created note). The shared save
   * does not write until this is false.
   */
  roomNotPersistent?: boolean;
  /**
   * How the text is seeded and rebuilt. Without it the room's file name
   * decides, which fits a Drive path but not an id such as a note UID.
   */
  documentFormat?: TextEditorContentFormat;
  onPersistForbidden?: () => void;
  /**
   * The server answered 404. Retrying the save stops. The local copy stays.
   * A host that resolves `true` found the document elsewhere and moves the
   * editor there, so no "document gone" notice is shown.
   */
  onDocumentGone?: () => void | Promise<boolean>;
  /**
   * The server answered 409 `note_archived` (#1535). Retrying stops and the
   * save is no longer pending: archive wins over the unsaved edit.
   */
  onPersistArchived?: () => void;
  /**
   * The stored state is not an ancestor of the journal, and this client has
   * unsaved work. Nothing is written until the person chooses.
   */
  onExternalWrite?: (detail: {
    markdown: string;
    title: string | null;
    serverState: Uint8Array;
  }) => void;
  /** Called with the markdown the server accepted. */
  onPersistSuccess?: (markdown: string) => void;
};

export const DEFAULT_DOCS_COLLAB_URLS: DocsCollabUrls = {
  signalUrl: "/api/v1/rooms/f_ZG9jcy90ZXN0LXRvZ2V0aGVyLm1k/events",
  collabApiBaseUrl: "/api/v1/rooms",
  collabRtcUrl: "/api/v1/rooms/f_ZG9jcy90ZXN0LXRvZ2V0aGVyLm1k/configuration",
  documentUrl: "/api/v1/files/collaboration?path=docs%2Ftest-together.md",
  yjsUrl: "/api/v1/files/collaboration?path=docs%2Ftest-together.md&format=yjs",
  room: "docs/test-together.md",
};

export type DocsCollabSession = {
  ydoc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  /** Caret label and colour for peers (awareness only, never stored in the document). */
  user: { name: string; color: string };
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

/** Why a save stopped for good. `forbidden` lifts on reconnect; the others stay. */
export type DocsCollabSaveTerminalKind = "gone" | "forbidden" | "too-large" | "archived";

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
  saveTerminalKindRef: MutableRefObject<DocsCollabSaveTerminalKind | null>;
  localDirtySinceLastSaveRef: MutableRefObject<boolean>;
  pendingServerSaveRef: MutableRefObject<boolean>;
  /** Entity tag of the outside text this client showed; the next save names it. */
  externalWriteSeenRef: MutableRefObject<string | null>;
  /** While set, a save must not replace an outside edit the person has not chosen. */
  externalWriteHoldRef: MutableRefObject<boolean>;
  /** Markdown to store instead of the editor view, for one save. */
  markdownOverrideRef: MutableRefObject<string | null>;
  lastKnownMarkdownRef: MutableRefObject<string>;
  lastSuccessfulSaveSignatureRef: MutableRefObject<string | null>;
  sessionRef: MutableRefObject<DocsCollabSession | null>;
  tabSyncRef: MutableRefObject<DocsCollabTabSyncApi | null>;
};
