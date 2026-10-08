/**
 * Principal link supervision as a pure reducer. One state per remote principal
 * peer. Effects are executed by `LinkSupervisor` (link-supervisor-runtime.ts).
 *
 * Rules: only the initiator dials. A non-initiator that sees the link down sends
 * a `link-down` hint through the principal mailbox. The initiator dials on a hint,
 * at most once per `LINK_DIAL_MIN_GAP_MS`.
 */

export const LINK_CONNECT_GRACE_MS = 10_000;
export const LINK_BACKOFF_MS = [5_000, 10_000, 20_000, 30_000, 60_000] as const;
export const LINK_DIAL_MIN_GAP_MS = 10_000;
export const LINK_DOWN_TYPE = "link-down";

export type LinkObservation = "open" | "connecting" | "failed" | "absent";
export type LinkPhase = "pending" | "up" | "down";

export type LinkPeerState = {
  phase: LinkPhase;
  since: number;
  downSince: number | null;
  attempt: number;
  lastDialAt: number | null;
};

export type LinkDownHint = { v: 1; since: number };

export type LinkEvent =
  | { type: "roster"; peerIds: readonly string[] }
  | { type: "observe"; peerId: string; obs: LinkObservation }
  | { type: "timer"; peerId: string }
  | { type: "hint"; peerId: string }
  | { type: "network-change" };

export type LinkEffect =
  | { type: "dial"; peerId: string }
  | { type: "hint"; peerId: string; hint: LinkDownHint }
  | { type: "schedule"; peerId: string; delayMs: number }
  | { type: "cancel"; peerId: string }
  | { type: "log"; event: string; details: Record<string, unknown> };

export type LinkContext = { now: number; isInitiator: (peerId: string) => boolean };

export type LinkReduction = { state: Map<string, LinkPeerState>; effects: LinkEffect[] };

export function isLinkDownHint(value: unknown): value is LinkDownHint {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return row.v === 1 && typeof row.since === "number" && Number.isFinite(row.since);
}

export function backoffDelay(attempt: number): number {
  const index = Math.min(Math.max(attempt - 1, 0), LINK_BACKOFF_MS.length - 1);
  return LINK_BACKOFF_MS[index] ?? LINK_BACKOFF_MS[LINK_BACKOFF_MS.length - 1];
}

export function reduceLink(
  state: ReadonlyMap<string, LinkPeerState>,
  event: LinkEvent,
  ctx: LinkContext,
): LinkReduction {
  const next = new Map(state);
  const effects: LinkEffect[] = [];
  if (event.type === "roster") onRoster(next, event.peerIds, ctx, effects);
  else if (event.type === "observe") onObserve(next, event.peerId, event.obs, ctx, effects);
  else if (event.type === "timer") onTimer(next, event.peerId, ctx, effects);
  else if (event.type === "hint") onHint(next, event.peerId, ctx, effects);
  else onNetworkChange(next, ctx, effects);
  return { state: next, effects };
}

function onRoster(
  next: Map<string, LinkPeerState>,
  peerIds: readonly string[],
  ctx: LinkContext,
  effects: LinkEffect[],
): void {
  const wanted = new Set(peerIds);
  for (const id of [...next.keys()].sort()) {
    if (wanted.has(id)) continue;
    next.delete(id);
    effects.push({ type: "cancel", peerId: id });
  }
  for (const id of [...wanted].sort()) {
    if (next.has(id)) continue;
    next.set(id, {
      phase: "pending",
      since: ctx.now,
      downSince: null,
      attempt: 0,
      lastDialAt: null,
    });
    effects.push({ type: "schedule", peerId: id, delayMs: LINK_CONNECT_GRACE_MS });
  }
}

function onObserve(
  next: Map<string, LinkPeerState>,
  id: string,
  obs: LinkObservation,
  ctx: LinkContext,
  effects: LinkEffect[],
): void {
  const peer = next.get(id);
  if (!peer) return;
  if (obs === "open") {
    if (peer.phase === "up") return;
    next.set(id, { ...peer, phase: "up", since: ctx.now, downSince: null, attempt: 0 });
    effects.push({ type: "cancel", peerId: id });
    effects.push({ type: "log", event: "link-up", details: { remoteId: id } });
    return;
  }
  if (peer.phase !== "up") return;
  if (obs === "connecting") {
    next.set(id, { ...peer, phase: "pending", since: ctx.now });
    effects.push({ type: "schedule", peerId: id, delayMs: LINK_CONNECT_GRACE_MS });
    effects.push({ type: "log", event: "link-pending", details: { remoteId: id } });
    return;
  }
  enterDown(next, id, ctx, effects, obs);
}

function onTimer(
  next: Map<string, LinkPeerState>,
  id: string,
  ctx: LinkContext,
  effects: LinkEffect[],
): void {
  const peer = next.get(id);
  if (!peer) return;
  if (peer.phase === "pending") enterDown(next, id, ctx, effects, "grace-expired");
  else if (peer.phase === "down") retry(next, id, ctx, effects);
}

function onHint(
  next: Map<string, LinkPeerState>,
  id: string,
  ctx: LinkContext,
  effects: LinkEffect[],
): void {
  const peer = next.get(id);
  if (!peer) return;
  if (!ctx.isInitiator(id)) {
    effects.push({ type: "log", event: "link-hint-ignored", details: { remoteId: id } });
    return;
  }
  effects.push({ type: "log", event: "link-hint-received", details: { remoteId: id } });
  if (peer.phase === "up") {
    enterDown(next, id, ctx, effects, "remote-hint");
    return;
  }
  if (peer.lastDialAt !== null && ctx.now - peer.lastDialAt < LINK_DIAL_MIN_GAP_MS) return;
  next.set(id, { ...peer, lastDialAt: ctx.now });
  effects.push({ type: "dial", peerId: id });
}

function onNetworkChange(
  next: Map<string, LinkPeerState>,
  ctx: LinkContext,
  effects: LinkEffect[],
): void {
  for (const id of [...next.keys()].sort()) {
    const peer = next.get(id);
    if (!peer || peer.phase !== "down") continue;
    next.set(id, { ...peer, attempt: 0, lastDialAt: null });
    retry(next, id, ctx, effects);
  }
}

function enterDown(
  next: Map<string, LinkPeerState>,
  id: string,
  ctx: LinkContext,
  effects: LinkEffect[],
  reason: string,
): void {
  const peer = next.get(id);
  if (!peer) return;
  next.set(id, { ...peer, phase: "down", since: ctx.now, downSince: ctx.now, attempt: 0 });
  effects.push({ type: "log", event: "link-down", details: { remoteId: id, reason } });
  retry(next, id, ctx, effects);
}

function retry(
  next: Map<string, LinkPeerState>,
  id: string,
  ctx: LinkContext,
  effects: LinkEffect[],
): void {
  const peer = next.get(id);
  if (!peer) return;
  const attempt = peer.attempt + 1;
  let lastDialAt = peer.lastDialAt;
  if (ctx.isInitiator(id)) {
    if (lastDialAt === null || ctx.now - lastDialAt >= LINK_DIAL_MIN_GAP_MS) {
      effects.push({ type: "dial", peerId: id });
      lastDialAt = ctx.now;
    }
  } else {
    effects.push({
      type: "hint",
      peerId: id,
      hint: { v: 1, since: peer.downSince ?? ctx.now },
    });
  }
  next.set(id, { ...peer, attempt, lastDialAt });
  effects.push({ type: "schedule", peerId: id, delayMs: backoffDelay(attempt) });
}
