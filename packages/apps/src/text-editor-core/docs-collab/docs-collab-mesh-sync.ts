import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { MESH_ORIGIN } from "./docs-collab-utils";

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
