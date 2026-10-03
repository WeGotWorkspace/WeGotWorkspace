import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import type { DocsCollabSenderTrust } from "./docs-collab-types";
import { applyGuardedRemoteUpdate, type DocsCollabUpdateVerdict } from "./docs-collab-update-guard";
import { MESH_ORIGIN } from "./docs-collab-utils";

/** y-protocols/sync message types, read off the first varuint. */
export const SYNC_STEP_1 = 0;

export const SYNC_STEP_2 = 1;

export const SYNC_UPDATE = 2;

export function encodeSyncStep1(ydoc: Y.Doc): number[] {
  const encoder = encoding.createEncoder();
  syncProtocol.writeSyncStep1(encoder, ydoc);
  return Array.from(encoding.toUint8Array(encoder));
}

export function encodeUpdateBroadcast(update: Uint8Array): number[] {
  const encoder = encoding.createEncoder();
  syncProtocol.writeUpdate(encoder, update);
  return Array.from(encoding.toUint8Array(encoder));
}

export type SyncReply = { type: "sync"; u: number[] };

export function handleSyncMessage(
  updateBytes: number[],
  ydoc: Y.Doc,
  origin: string = MESH_ORIGIN,
): SyncReply | null {
  const decoder = decoding.createDecoder(Uint8Array.from(updateBytes));
  const encoder = encoding.createEncoder();
  syncProtocol.readSyncMessage(decoder, encoder, ydoc, origin);
  if (encoding.length(encoder) > 1) {
    return { type: "sync", u: Array.from(encoding.toUint8Array(encoder)) };
  }
  return null;
}

/** True for a message that carries document content rather than asking for it. */
export function isDocumentBearingSyncMessage(bytes: readonly number[]): boolean {
  return bytes[0] === SYNC_STEP_2 || bytes[0] === SYNC_UPDATE;
}

export type GuardedSyncOutcome =
  | { kind: "reply"; reply: SyncReply }
  | { kind: "update"; verdict: DocsCollabUpdateVerdict }
  | { kind: "ignored" };

/**
 * The receive side of `handleSyncMessage`, split so the access filter sits
 * between decoding a message and applying it.
 *
 * A step 1 only asks for state and is answered whoever sent it — joining the
 * room already required read access. A step 2 and an update both carry content,
 * and a step 2 is not a safe shortcut: a tampered client can put its own edits
 * in one. Both go through the guard with the sender's resolved right, which
 * defaults to `read` when the transport could not establish who they are.
 */
export function handleGuardedSyncMessage(input: {
  bytes: number[];
  ydoc: Y.Doc;
  trust?: DocsCollabSenderTrust;
  from?: string;
  origin?: string;
}): GuardedSyncOutcome {
  const decoder = decoding.createDecoder(Uint8Array.from(input.bytes));
  const messageType = decoding.readVarUint(decoder);

  if (messageType === SYNC_STEP_1) {
    const encoder = encoding.createEncoder();
    syncProtocol.writeSyncStep2(encoder, input.ydoc, decoding.readVarUint8Array(decoder));
    return {
      kind: "reply",
      reply: { type: "sync", u: Array.from(encoding.toUint8Array(encoder)) },
    };
  }

  if (messageType !== SYNC_STEP_2 && messageType !== SYNC_UPDATE) {
    return { kind: "ignored" };
  }

  return {
    kind: "update",
    verdict: applyGuardedRemoteUpdate({
      doc: input.ydoc,
      update: decoding.readVarUint8Array(decoder),
      access: input.trust?.access ?? "read",
      senderUser: input.trust?.user ?? "",
      origin: input.origin ?? MESH_ORIGIN,
      from: input.from,
    }),
  };
}

/**
 * A follower tab applies what the leader tab relays without re-checking it, so
 * the leader only passes on an update the guard accepted.
 */
export function mayRelayGuardedOutcomeToTabs(outcome: GuardedSyncOutcome): boolean {
  return outcome.kind !== "update" || outcome.verdict.applied;
}

export function applyAwarenessUpdate(
  updateBytes: number[],
  awareness: awarenessProtocol.Awareness,
  origin: string = MESH_ORIGIN,
): void {
  awarenessProtocol.applyAwarenessUpdate(awareness, Uint8Array.from(updateBytes), origin);
}

export function encodeAwarenessBroadcast(
  awareness: awarenessProtocol.Awareness,
  changed: number[],
): number[] {
  const encoded = awarenessProtocol.encodeAwarenessUpdate(awareness, changed);
  return Array.from(encoded);
}

/** Full local awareness snapshot for proactive send on dc-open (before mesh existed at join). */
export function encodeFullAwarenessBroadcast(
  awareness: awarenessProtocol.Awareness,
): number[] | null {
  const clientIds = [...awareness.getStates().keys()];
  if (clientIds.length === 0) return null;
  return encodeAwarenessBroadcast(awareness, clientIds);
}
