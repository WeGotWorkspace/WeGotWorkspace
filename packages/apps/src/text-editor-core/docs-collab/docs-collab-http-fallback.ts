import { YJS_HTTP_FALLBACK_AFTER_MS, YJS_HTTP_RELAY_AFTER_MS } from "./docs-collab-http-wire";

export type HttpFallbackPeer = {
  id: string;
  name: string;
  caps?: readonly string[];
  connected: boolean;
  seenAt: number;
};

function advertises(peer: HttpFallbackPeer, cap: string): boolean {
  return peer.caps?.includes(cap) === true;
}

/** Peers that should receive local updates on the mailbox right now. */
export function httpFallbackPeers(
  peers: readonly HttpFallbackPeer[],
  now: number,
  immediate: boolean,
): HttpFallbackPeer[] {
  return peers.filter((peer) => {
    if (peer.connected || !advertises(peer, "yjs-http")) return false;
    if (immediate) return true;
    return now - peer.seenAt >= YJS_HTTP_FALLBACK_AFTER_MS;
  });
}

/**
 * `to: "*"` when every peer that is still offline needs this update. A peer
 * without `yjs-http` cannot take the fan-out, so the send stays targeted.
 */
export function httpFallbackUsesStar(
  peers: readonly HttpFallbackPeer[],
  httpPeers: readonly HttpFallbackPeer[],
): boolean {
  const offline = peers.filter((peer) => !peer.connected);
  if (httpPeers.length === 0 || offline.length === 0) return false;
  if (httpPeers.length !== offline.length) return false;
  const ids = new Set(httpPeers.map((peer) => peer.id));
  return offline.every((peer) => ids.has(peer.id));
}

/** Relay is requested once a pair has had no data channel for 8 seconds. */
export function relayDuePeers(
  peers: readonly HttpFallbackPeer[],
  now: number,
  immediate: boolean,
  requested: ReadonlySet<string>,
): HttpFallbackPeer[] {
  return peers.filter((peer) => {
    if (peer.connected || requested.has(peer.id) || !advertises(peer, "relay-jit")) return false;
    if (immediate) return true;
    return now - peer.seenAt >= YJS_HTTP_RELAY_AFTER_MS;
  });
}
