import * as Y from "yjs";
import { hash32, isYDocEmpty } from "./docs-collab-utils";

/**
 * Bump when a change to the seeding pipeline would alter the Yjs items built
 * from the same markdown. Clients on different versions then seed under
 * different ids instead of interleaving two near-identical item runs.
 */
export const SEED_FORMAT_VERSION = "1";

/**
 * Seeding writes into a throwaway Y.Doc whose clientID is derived from the
 * content, so every client that seeds the same markdown produces byte-identical
 * items. Merging those is then a no-op instead of a second copy.
 */
export function seedClientId(documentFormat: string, markdown: string): number {
  return hash32(`${SEED_FORMAT_VERSION}\u0000${documentFormat}\u0000${markdown}`);
}

export type SeedMeshContext = {
  getPeerIds: () => string[];
  getMyId: () => string | null | undefined;
  linkCount: () => number;
} | null;

export function isLowestPeer(myId: string, peerIds: string[]): boolean {
  let min = myId;
  for (const id of peerIds) {
    if (id < min) min = id;
  }
  return myId === min;
}

export function shouldDeferToMeshSeed(
  mesh: SeedMeshContext,
  ydoc: Y.Doc,
  seedDone: boolean,
): boolean {
  if (!ydoc || seedDone || !isYDocEmpty(ydoc)) return false;
  if (!mesh) return false;
  return mesh.getPeerIds().length > 0;
}

export function canSeedFromFile(
  mesh: SeedMeshContext,
  myId: string | null | undefined,
  peerIds: string[],
): boolean {
  if (peerIds.length === 0) return true;
  if (!myId) return false;
  if (!isLowestPeer(myId, peerIds)) return false;
  if (!mesh || mesh.linkCount() === 0) return false;
  return true;
}

export function resolveBootstrapSeed(markdown: string, seedContent: string | undefined): string {
  return markdown || seedContent || "";
}

export function shouldSeedOffline(
  mesh: SeedMeshContext,
  ydoc: Y.Doc,
  seedDone: boolean,
  seedContent: string | undefined,
): boolean {
  if (seedDone || !isYDocEmpty(ydoc)) return false;
  if (mesh && mesh.getPeerIds().length > 0) return false;
  return Boolean(seedContent);
}

export function shouldApplyImmediateSeed(
  mesh: SeedMeshContext,
  ydoc: Y.Doc,
  seedDone: boolean,
  seed: string,
): boolean {
  if (seedDone || !isYDocEmpty(ydoc) || !seed) return false;
  if (!mesh || mesh.getPeerIds().length === 0) return true;
  return false;
}

export function markSeedDoneAfterSnapshot(hadSnapshot: boolean): boolean {
  return hadSnapshot;
}
