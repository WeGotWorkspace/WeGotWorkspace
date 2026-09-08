import { meetLabels } from "@/meet-core/src/meet-labels";
import type { CollectionSharePrincipal } from "@/share-ui/collection-share";

export function meetCallBarRoster<T extends { id: string }>({
  joined,
  self,
  peers,
}: {
  joined: boolean;
  self: T;
  peers: readonly T[];
}): T[] {
  return joined ? [self, ...peers] : [...peers];
}

export function meetCallBarShownCount({
  joined,
  participantCount,
  peerCount,
}: {
  joined: boolean;
  participantCount: number;
  peerCount: number;
}): number {
  return joined ? participantCount : peerCount;
}

export function meetCallBarMeta(count: number, elapsed?: string): string {
  const parts: string[] = [];
  if (count > 0) parts.push(meetLabels.inCallCount(count));
  const timer = elapsed?.trim();
  if (timer) parts.push(timer);
  return parts.join(" · ");
}

export function meetCallPreviewPeers(
  usernames: readonly string[],
  directory?: readonly CollectionSharePrincipal[] | null,
): { id: string; name: string }[] {
  return usernames.map((id) => {
    const person = directory?.find((row) => row.id === id);
    return { id, name: person?.displayName?.trim() || id };
  });
}
