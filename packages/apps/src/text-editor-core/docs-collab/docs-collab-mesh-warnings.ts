import type {
  DocsCollabMeshPeer,
  DocsCollabMeshPeerStatus,
  DocsCollabPeerLinkState,
} from "@/text-editor-core/docs-collab/docs-collab-types";

/** Delay before a failed ICE link becomes the "Could not connect" presence warning. */
export const PEER_FAILURE_WARNING_DELAY_MS = 6000;

const WARNING_LINKS = new Set<DocsCollabPeerLinkState>(["failed", "disconnected", "closed"]);

/** True only for hard link failures — not the silent connecting window of a reuse→ICE fallback. */
export function isCollabWarningLink(link: DocsCollabPeerLinkState): boolean {
  return WARNING_LINKS.has(link);
}

/**
 * Presence warning avatars. A reuse drop that leaves the peer `connecting` (fresh
 * ICE) must not appear here; that is the accepted 0.5–2 s silent reconnect.
 */
export function collectCollabWarningPeers(
  statuses: DocsCollabMeshPeerStatus[],
  failedSince: ReadonlyMap<string, number>,
  now: number,
  warningDelayMs: number = PEER_FAILURE_WARNING_DELAY_MS,
): DocsCollabMeshPeer[] {
  const warning: DocsCollabMeshPeer[] = [];
  for (const peer of statuses) {
    if (!isCollabWarningLink(peer.link)) continue;
    const since = failedSince.get(peer.id) ?? now;
    if (now - since >= warningDelayMs) {
      warning.push({ id: peer.id, name: peer.name });
    }
  }
  return warning;
}
