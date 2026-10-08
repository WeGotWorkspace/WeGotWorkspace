import type {
  LinkChannelKind,
  LinkPeer,
  RoomEndpointState,
} from "@/lib/rtc/link/link-channel-types";

export const LINK_LABEL_PREFIX = "wgw1/";
export const LINK_HUB_TICK_MS = 2_000;
export const LINK_OPEN_TIMEOUT_MS = 10_000;
export const LINK_ACCEPT_TIMEOUT_MS = 5_000;
export const LINK_HELLO_TIMEOUT_MS = 5_000;
export const LINK_ROSTER_WAIT_MS = 2_000;
export const LINK_RETRY_AFTER_CLOSE_MS = 5_000;
export const LINK_RETRY_AFTER_REJECT_MS = 10_000;
export const LINK_RETRY_AFTER_NOT_IN_ROOM_MS = 30_000;

export type LinkRejectReason =
  "not-in-room" | "not-rostered" | "user-mismatch" | "ticket-rejected" | "bad-hello";

const REJECT_REASONS: ReadonlySet<string> = new Set([
  "not-in-room",
  "not-rostered",
  "user-mismatch",
  "ticket-rejected",
  "bad-hello",
]);

export type HelloFrame = { t: "hello"; v: 1; peer: string; ticket?: string };
export type AcceptFrame = { t: "accept"; peer: string };
export type RejectFrame = { t: "reject"; reason: LinkRejectReason };
export type DataFrame = { t: "d"; m: unknown };
export type LinkFrame = HelloFrame | AcceptFrame | RejectFrame | DataFrame;

export function buildLinkLabel(kind: LinkChannelKind, roomKey: string): string {
  return `${LINK_LABEL_PREFIX}${kind}/${roomKey}`;
}

export function parseLinkLabel(label: string): { kind: LinkChannelKind; roomKey: string } | null {
  const match = /^wgw1\/(collab)\/([0-9a-f]{40})$/.exec(label);
  if (!match?.[1] || !match[2]) return null;
  return { kind: match[1] as LinkChannelKind, roomKey: match[2] };
}

export function parseLinkFrame(text: string): LinkFrame | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (row.t === "hello") {
    if (row.v !== 1 || typeof row.peer !== "string" || row.peer === "") return null;
    if (row.ticket !== undefined && typeof row.ticket !== "string") return null;
    return row.ticket === undefined
      ? { t: "hello", v: 1, peer: row.peer }
      : { t: "hello", v: 1, peer: row.peer, ticket: row.ticket };
  }
  if (row.t === "accept") {
    return typeof row.peer === "string" && row.peer !== "" ? { t: "accept", peer: row.peer } : null;
  }
  if (row.t === "reject") {
    return typeof row.reason === "string" && REJECT_REASONS.has(row.reason)
      ? { t: "reject", reason: row.reason as LinkRejectReason }
      : null;
  }
  if (row.t === "d") return "m" in row ? { t: "d", m: row.m } : null;
  return null;
}

export type OutboundState = "opening" | "await-accept" | "ready" | "closed" | "rejected";

export type OutboundRecord = {
  roomKey: string;
  linkPeer: string;
  state: OutboundState;
  acceptedPeer: string | null;
  /** When the record entered its current state. */
  since: number;
  /** For closed/rejected: earliest time a new open is allowed. */
  retryAt: number;
};

export function outboundKey(roomKey: string, linkPeer: string): string {
  return `${roomKey}|${linkPeer}`;
}

export type OutboundAction = { op: "open" | "close"; roomKey: string; linkPeer: string };

/** Which outbound channels to open or close now. Pure and sorted by key. */
export function planOutbound(input: {
  rooms: readonly RoomEndpointState[];
  links: readonly LinkPeer[];
  outbound: ReadonlyMap<string, OutboundRecord>;
  now: number;
}): OutboundAction[] {
  const wanted = new Map<string, { roomKey: string; linkPeer: string }>();
  for (const room of input.rooms) {
    for (const row of room.roster) {
      if (row.id === room.myPeerId) continue;
      for (const link of input.links) {
        if (link.user !== row.user) continue;
        wanted.set(outboundKey(room.roomKey, link.linkPeer), {
          roomKey: room.roomKey,
          linkPeer: link.linkPeer,
        });
      }
    }
  }
  const actions: Array<OutboundAction & { key: string }> = [];
  for (const [key, target] of wanted) {
    const record = input.outbound.get(key);
    const reopen =
      !record ||
      ((record.state === "closed" || record.state === "rejected") && input.now >= record.retryAt);
    if (reopen) actions.push({ key, op: "open", ...target });
  }
  for (const [key, record] of input.outbound) {
    if (wanted.has(key)) continue;
    if (record.state === "closed" || record.state === "rejected") continue;
    actions.push({ key, op: "close", roomKey: record.roomKey, linkPeer: record.linkPeer });
  }
  actions.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.op < b.op ? -1 : 1));
  return actions.map(({ key: _key, ...action }) => action);
}

export function retryDelayForReject(reason: LinkRejectReason): number {
  return reason === "not-in-room" ? LINK_RETRY_AFTER_NOT_IN_ROOM_MS : LINK_RETRY_AFTER_REJECT_MS;
}
