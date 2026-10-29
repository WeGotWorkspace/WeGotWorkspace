import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import type { DocsCollabSenderTrust } from "./docs-collab-types";
import { mayAnswerSyncStep1WithLocalState } from "./docs-collab-mesh-hydration";
import { applyGuardedRemoteUpdate, type DocsCollabUpdateVerdict } from "./docs-collab-update-guard";
import { isYDocEmpty, MESH_ORIGIN } from "./docs-collab-utils";

/** y-protocols/sync message types, read off the first varuint. */
export const SYNC_STEP_1 = 0;

export const SYNC_STEP_2 = 1;

export const SYNC_UPDATE = 2;

export function encodeSyncStep1(ydoc: Y.Doc): Uint8Array {
  const encoder = encoding.createEncoder();
  syncProtocol.writeSyncStep1(encoder, ydoc);
  return encoding.toUint8Array(encoder);
}

export function encodeUpdateBroadcast(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  syncProtocol.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
}

export type SyncReply = { type: "sync"; u: Uint8Array };

export function handleSyncMessage(
  updateBytes: Uint8Array,
  ydoc: Y.Doc,
  origin: string = MESH_ORIGIN,
): SyncReply | null {
  const decoder = decoding.createDecoder(updateBytes);
  const encoder = encoding.createEncoder();
  syncProtocol.readSyncMessage(decoder, encoder, ydoc, origin);
  if (encoding.length(encoder) > 1) {
    return { type: "sync", u: encoding.toUint8Array(encoder) };
  }
  return null;
}

/** True for a message that carries document content rather than asking for it. */
export function isDocumentBearingSyncMessage(bytes: Uint8Array): boolean {
  return bytes[0] === SYNC_STEP_2 || bytes[0] === SYNC_UPDATE;
}

/** Raw Yjs update inside a step 2 or update message. A state request has none. */
export function documentUpdateFromSyncMessage(bytes: Uint8Array): Uint8Array | null {
  if (!isDocumentBearingSyncMessage(bytes)) return null;
  const decoder = decoding.createDecoder(bytes);
  decoding.readVarUint(decoder);
  return decoding.readVarUint8Array(decoder);
}

/**
 * True when `remoteStateVector` counts structs this doc has not integrated.
 * A gap that leaves later updates pending counts too: the state vector only
 * covers what was integrated.
 */
export function stateVectorIsAhead(ydoc: Y.Doc, remoteStateVector: Uint8Array): boolean {
  const local = Y.decodeStateVector(Y.encodeStateVector(ydoc));
  for (const [client, clock] of Y.decodeStateVector(remoteStateVector)) {
    if (clock > (local.get(client) ?? 0)) return true;
  }
  return false;
}

export type GuardedSyncOutcome =
  /** `pullBack`: the sender holds state this doc lacks, so ask it with a step 1. */
  | { kind: "reply"; reply: SyncReply; pullBack: boolean }
  | { kind: "update"; verdict: DocsCollabUpdateVerdict }
  | { kind: "ignored" }
  | { kind: "hydration-blocked"; requestPull: true };

/**
 * The receive side of `handleSyncMessage`, split so the access filter sits
 * between decoding a message and applying it.
 *
 * A step 1 only asks for state and is answered whoever sent it — joining the
 * room already required read access. Its state vector also shows whether the
 * sender holds updates this doc missed; then the caller pulls them back.
 *
 * A step 2 and an update both carry content, and a step 2 is not a safe
 * shortcut: a tampered client can put its own edits in one. Both go through
 * the guard with the sender's resolved right, which defaults to `read` when
 * the transport could not establish who they are.
 */
export function handleGuardedSyncMessage(input: {
  bytes: Uint8Array;
  ydoc: Y.Doc;
  trust?: DocsCollabSenderTrust;
  from?: string;
  origin?: string;
  /** When false and the doc body is still empty, step 1 is not answered. */
  mayAnswerSyncStep1?: boolean;
}): GuardedSyncOutcome {
  const decoder = decoding.createDecoder(input.bytes);
  const messageType = decoding.readVarUint(decoder);
  const mayAnswer = input.mayAnswerSyncStep1 ?? true;

  if (messageType === SYNC_STEP_1) {
    if (!mayAnswer && isYDocEmpty(input.ydoc)) {
      return { kind: "hydration-blocked", requestPull: true };
    }
    const remoteStateVector = decoding.readVarUint8Array(decoder);
    const encoder = encoding.createEncoder();
    syncProtocol.writeSyncStep2(encoder, input.ydoc, remoteStateVector);
    return {
      kind: "reply",
      reply: { type: "sync", u: encoding.toUint8Array(encoder) },
      pullBack: stateVectorIsAhead(input.ydoc, remoteStateVector),
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
  if (outcome.kind === "hydration-blocked") return false;
  return outcome.kind !== "update" || outcome.verdict.applied;
}

/** @deprecated Use mayPublishDocumentBearingMeshSync — step 1 pulls are always allowed. */
export function mayInitiateMeshDocumentSync(ydoc: Y.Doc, seedDone: boolean): boolean {
  return mayAnswerSyncStep1WithLocalState(ydoc, seedDone);
}

export function applyAwarenessUpdate(
  updateBytes: Uint8Array,
  awareness: awarenessProtocol.Awareness,
  origin: string = MESH_ORIGIN,
): void {
  awarenessProtocol.applyAwarenessUpdate(awareness, updateBytes, origin);
}

export function encodeAwarenessBroadcast(
  awareness: awarenessProtocol.Awareness,
  changed: number[],
): Uint8Array {
  return awarenessProtocol.encodeAwarenessUpdate(awareness, changed);
}

/** Full local awareness snapshot for proactive send on dc-open (before mesh existed at join). */
export function encodeFullAwarenessBroadcast(
  awareness: awarenessProtocol.Awareness,
): Uint8Array | null {
  const clientIds = [...awareness.getStates().keys()];
  if (clientIds.length === 0) return null;
  return encodeAwarenessBroadcast(awareness, clientIds);
}
