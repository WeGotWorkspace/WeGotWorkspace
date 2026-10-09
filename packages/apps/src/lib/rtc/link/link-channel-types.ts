import type { DocsCollabAccess } from "@/text-editor-core/docs-collab/docs-collab-access";
import type { DocsCollabTicketJwk } from "@/text-editor-core/docs-collab/docs-collab-ticket";

export type LinkChannelKind = "collab";

/** One live principal link to another browser. */
export type LinkPeer = { linkPeer: string; user: string };

/** The parts of an RTCDataChannel the hub uses. Real channels satisfy it. */
export type ChannelLike = {
  label: string;
  readyState: RTCDataChannelState;
  binaryType: BinaryType;
  bufferedAmount: number;
  bufferedAmountLowThreshold: number;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: Event) => void) | null;
  send(data: string | ArrayBufferView | ArrayBuffer): void;
  close(): void;
  addEventListener: RTCDataChannel["addEventListener"];
  removeEventListener: RTCDataChannel["removeEventListener"];
};

export type LinkHost = {
  livePeers(): LinkPeer[];
  createChannel(linkPeer: string, label: string): ChannelLike | null;
  peerAdvertisesBin(linkPeer: string): boolean;
  onIncomingChannel(listener: (linkPeer: string, channel: ChannelLike) => void): () => void;
  onLinksChanged(listener: () => void): () => void;
};

export type RoomRosterRow = { id: string; user: string; access: DocsCollabAccess };

/** What a room owner (a Docs session) tells the hub. Structured-clone safe. */
export type RoomEndpointState = {
  kind: LinkChannelKind;
  /** `collabRoomKey(room)`: 40 lowercase hex chars. */
  roomKey: string;
  myPeerId: string;
  ticket?: string;
  jwk: DocsCollabTicketJwk | null;
  roster: RoomRosterRow[];
};

export type PeerChannelState = { out: boolean; in: boolean };

export type LinkTrust = { user: string; access: DocsCollabAccess };

export type LinkRoomListener = {
  onMessage: (from: string, msg: unknown, trust: LinkTrust) => void;
  onState: (states: ReadonlyMap<string, PeerChannelState>) => void;
  onNeedRoster: () => void;
};

/** Where the hub delivers events for one owner (a window). */
export type OwnerSink = {
  message: (roomKey: string, from: string, msg: unknown, trust: LinkTrust) => void;
  state: (roomKey: string, states: Array<[string, PeerChannelState]>) => void;
  needRoster: (roomKey: string) => void;
};

export interface LinkChannelClient {
  available(): boolean;
  setRoom(state: RoomEndpointState): void;
  removeRoom(roomKey: string): void;
  kick(roomKey: string): void;
  send(roomKey: string, toPeer: string, msg: unknown): boolean;
  broadcast(roomKey: string, msg: unknown): number;
  peerStates(roomKey: string): ReadonlyMap<string, PeerChannelState>;
  subscribe(roomKey: string, listener: LinkRoomListener): () => void;
}
