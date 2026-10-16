import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness";
import * as Y from "yjs";

export type Link = {
  setLatency(ms: number): void;
  setOffline(side: "a" | "b", value: boolean): void;
  destroy(): void;
};

type Side = "a" | "b";

type AwarenessEvent = { added: number[]; updated: number[]; removed: number[] };

export function link(a: Y.Doc, b: Y.Doc, aw: Awareness, bw: Awareness): Link {
  let latency = 0;
  const offline: Record<Side, boolean> = { a: false, b: false };
  const buffers: Record<Side, Uint8Array[]> = { a: [], b: [] };

  const targetDoc = (side: Side) => (side === "a" ? b : a);
  const sourceAw = (side: Side) => (side === "a" ? aw : bw);
  const targetAw = (side: Side) => (side === "a" ? bw : aw);

  const sendDoc = (side: Side, update: Uint8Array) => {
    const bytes = new Uint8Array(update);
    if (offline[side]) {
      buffers[side].push(bytes);
      return;
    }
    const delay = latency;
    const target = targetDoc(side);
    setTimeout(() => {
      Y.applyUpdate(target, bytes, "remote");
    }, delay);
  };

  const onA = (update: Uint8Array, origin: unknown) => {
    if (origin === "remote") return;
    sendDoc("a", update);
  };
  const onB = (update: Uint8Array, origin: unknown) => {
    if (origin === "remote") return;
    sendDoc("b", update);
  };

  const bindAwareness = (side: Side) => {
    const source = sourceAw(side);
    const onUpdate = (event: AwarenessEvent, origin: unknown) => {
      if (origin === "remote") return;
      if (offline[side]) return;
      const changed = [...event.added, ...event.updated, ...event.removed];
      if (changed.length === 0) return;
      const bytes = new Uint8Array(encodeAwarenessUpdate(source, changed));
      const target = targetAw(side);
      const delay = latency;
      setTimeout(() => {
        applyAwarenessUpdate(target, bytes, "remote");
      }, delay);
    };
    source.on("update", onUpdate as (event: unknown, origin: unknown) => void);
    return () => source.off("update", onUpdate as (event: unknown, origin: unknown) => void);
  };

  a.on("update", onA);
  b.on("update", onB);
  const offAw = bindAwareness("a");
  const offBw = bindAwareness("b");

  return {
    setLatency(ms: number) {
      latency = ms;
    },
    setOffline(side, value) {
      if (value && !offline[side]) {
        removeAwarenessStates(targetAw(side), [sourceAw(side).clientID], "remote");
      }
      offline[side] = value;
      if (value) return;
      const queued = buffers[side].splice(0);
      for (const update of queued) sendDoc(side, update);
      const state = sourceAw(side).getLocalState();
      if (state) sourceAw(side).setLocalState({ ...state });
    },
    destroy() {
      a.off("update", onA);
      b.off("update", onB);
      offAw();
      offBw();
    },
  };
}
