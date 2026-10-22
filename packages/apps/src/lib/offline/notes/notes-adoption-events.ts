/**
 * `local-*` → server id adoptions, announced to the open Notes UI.
 *
 * The outbox flush adopts an offline-created note without the UI knowing: the
 * list kept the temp row next to the server note, and the URL and editor stayed
 * on the temp id. Listeners in this tab are called directly; other tabs of the
 * same origin hear it over a BroadcastChannel.
 */
export type NoteAdoption = { username: string; localId: string; serverId: string };

type Listener = (adoption: NoteAdoption) => void;

const CHANNEL_NAME = "wgw-notes-adoptions";
const listeners = new Set<Listener>();
let channel: BroadcastChannel | null | undefined;

function broadcastChannel(): BroadcastChannel | null {
  if (channel !== undefined) return channel;
  channel = typeof BroadcastChannel === "function" ? new BroadcastChannel(CHANNEL_NAME) : null;
  channel?.addEventListener("message", (event: MessageEvent<NoteAdoption>) => {
    const adoption = event.data;
    if (adoption?.localId && adoption.serverId) emitLocal(adoption);
  });
  return channel;
}

function emitLocal(adoption: NoteAdoption): void {
  for (const listener of listeners) listener(adoption);
}

export function announceNoteAdoption(adoption: NoteAdoption): void {
  emitLocal(adoption);
  broadcastChannel()?.postMessage(adoption);
}

export function subscribeNoteAdoptions(listener: Listener): () => void {
  broadcastChannel();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
