/**
 * Collaboration rights as the server resolves them (contract C1) and the
 * roster bookkeeping that makes a collab peer trustworthy.
 *
 * The signaling roster is the only authority on who is in the room and what
 * they may do. A peer that is not on it is not a collaborator, whatever it
 * claims over the principal mesh, and a right that did not come from the
 * roster or from a verified ticket reads as `read`.
 */

import type { RtcPeerDescriptor } from "@/lib/rtc/types";

export type DocsCollabAccess = "read" | "comment" | "write";

/** Fail closed: the column defaults to `read` and so does everything here. */
export const DOCS_COLLAB_DEFAULT_ACCESS: DocsCollabAccess = "read";

export function normalizeDocsCollabAccess(value: unknown): DocsCollabAccess {
  return value === "write" || value === "comment" ? value : DOCS_COLLAB_DEFAULT_ACCESS;
}

export function docsCollabAccessMayEditBody(access: DocsCollabAccess): boolean {
  return access === "write";
}

export function docsCollabAccessMayBroadcast(access: DocsCollabAccess): boolean {
  return access !== "read";
}

const ACCESS_RANK: Record<DocsCollabAccess, number> = {
  read: 0,
  comment: 1,
  write: 2,
};

/** The weaker of two rights. A stale ticket cannot outrank the live roster. */
export function tighterDocsCollabAccess(
  left: DocsCollabAccess,
  right: DocsCollabAccess,
): DocsCollabAccess {
  return ACCESS_RANK[left] <= ACCESS_RANK[right] ? left : right;
}

type RosterEntry = {
  user: string;
  access: DocsCollabAccess;
};

/**
 * Last signaling roster, indexed the two ways the trust checks need it. Every
 * poll replaces it wholesale, so a revoked peer stops being rostered as soon
 * as the server drops it.
 */
export class DocsCollabRosterTrust {
  private readonly byPeerId = new Map<string, RosterEntry>();

  private readonly byUser = new Map<string, RosterEntry>();

  private myAccessValue: DocsCollabAccess = DOCS_COLLAB_DEFAULT_ACCESS;

  remember(peers: readonly RtcPeerDescriptor[], myPeerId: string | null): void {
    this.byPeerId.clear();
    this.byUser.clear();
    for (const peer of peers) {
      const entry: RosterEntry = {
        user: peer.user ?? "",
        access: normalizeDocsCollabAccess(peer.access),
      };
      this.byPeerId.set(peer.id, entry);
      if (entry.user !== "") this.byUser.set(entry.user, entry);
      if (myPeerId && peer.id === myPeerId) this.myAccessValue = entry.access;
    }
  }

  forget(): void {
    this.byPeerId.clear();
    this.byUser.clear();
    this.myAccessValue = DOCS_COLLAB_DEFAULT_ACCESS;
  }

  /** Rights for a direct collab data-channel peer, taken from the roster. */
  accessForPeerId(peerId: string): DocsCollabAccess {
    return this.byPeerId.get(peerId)?.access ?? DOCS_COLLAB_DEFAULT_ACCESS;
  }

  accessForUser(user: string): DocsCollabAccess {
    return this.byUser.get(user)?.access ?? DOCS_COLLAB_DEFAULT_ACCESS;
  }

  userForPeerId(peerId: string): string {
    return this.byPeerId.get(peerId)?.user ?? "";
  }

  /**
   * The principal `workspace` room holds every signed-in account, so a peer
   * offering to reuse a link is only a collaborator when the collab roster
   * says so.
   */
  isRosteredUser(user: string): boolean {
    return user !== "" && this.byUser.has(user);
  }

  isRosteredPeerId(peerId: string): boolean {
    return this.byPeerId.has(peerId);
  }

  /** This client's own right, used to keep a viewer from broadcasting. */
  myAccess(): DocsCollabAccess {
    return this.myAccessValue;
  }

  /**
   * The roster lists everyone except this client, so `remember` cannot learn
   * our own right from it. The poll ticket is that right, minted for us.
   */
  noteOwnAccess(access: DocsCollabAccess): void {
    this.myAccessValue = access;
  }
}
