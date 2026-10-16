import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import * as Y from "yjs";

type Msg =
  | { t: "hello"; from: number }
  | { t: "state"; from: number; data: Uint8Array }
  | { t: "update"; from: number; data: Uint8Array }
  | { t: "awareness"; from: number; data: Uint8Array }
  | { t: "bye"; from: number; clients: number[] };

export type Conn = {
  setLatency(ms: number): void;
  setOffline(v: boolean): void;
  waitForState(ms: number): Promise<boolean>;
  onPeers(cb: (clientIds: number[]) => void): void;
  destroy(): void;
};

type AwarenessEvent = { added: number[]; updated: number[]; removed: number[] };

const PEER_TIMEOUT_MS = 10_000;
const HEARTBEAT_MS = 3_000;

export function connect(doc: Y.Doc, awareness: Awareness, room: string): Conn {
  const channel = new BroadcastChannel(room);
  let latency = 0;
  let offline = false;
  let closed = false;
  let gotState = false;
  const buffer: Msg[] = [];
  const waiters: Array<(value: boolean) => void> = [];
  const peers = new Map<number, number>();
  let peersCb: ((clientIds: number[]) => void) | null = null;

  const emitPeers = () => {
    peersCb?.([...peers.keys()]);
  };

  const resolveWaiters = (value: boolean) => {
    if (value) gotState = true;
    for (const waiter of waiters.splice(0)) waiter(value);
  };

  const send = (msg: Msg) => {
    const outgoing = copyMsg(msg);
    if (offline && (outgoing.t === "update" || outgoing.t === "awareness")) {
      buffer.push(outgoing);
      return;
    }
    if (offline && outgoing.t === "hello") return;
    const delay = latency;
    setTimeout(() => {
      if (closed) return;
      channel.postMessage(outgoing);
    }, delay);
  };

  const touch = (clientId: number) => {
    if (clientId === doc.clientID) return;
    const known = peers.has(clientId);
    peers.set(clientId, Date.now());
    if (!known) emitPeers();
  };

  const onDoc = (data: Uint8Array, origin: unknown) => {
    if (origin === "remote") return;
    send({ t: "update", from: doc.clientID, data });
  };

  const onAwareness = (event: AwarenessEvent) => {
    const ids = [...event.added, ...event.updated, ...event.removed];
    if (!ids.includes(awareness.clientID)) return;
    send({
      t: "awareness",
      from: doc.clientID,
      data: encodeAwarenessUpdate(awareness, ids),
    });
  };

  const onMessage = (event: MessageEvent<Msg>) => {
    const msg = event.data;
    if (!msg || typeof msg !== "object" || msg.from === doc.clientID) return;
    if (msg.t === "bye") {
      const clients = Array.isArray(msg.clients) ? msg.clients : [];
      removeAwarenessStates(awareness, clients, "remote");
      let changed = peers.delete(msg.from);
      for (const clientId of clients) {
        if (peers.delete(clientId)) changed = true;
      }
      if (changed) emitPeers();
      return;
    }
    touch(msg.from);
    switch (msg.t) {
      case "hello":
        send({ t: "state", from: doc.clientID, data: Y.encodeStateAsUpdate(doc) });
        send({
          t: "awareness",
          from: doc.clientID,
          data: encodeAwarenessUpdate(awareness, [awareness.clientID]),
        });
        break;
      case "state":
        Y.applyUpdate(doc, msg.data, "remote");
        resolveWaiters(true);
        break;
      case "update":
        Y.applyUpdate(doc, msg.data, "remote");
        break;
      case "awareness":
        applyAwarenessUpdate(awareness, msg.data, "remote");
        break;
      default:
        break;
    }
  };

  doc.on("update", onDoc);
  awareness.on("update", onAwareness as (event: unknown) => void);
  channel.onmessage = onMessage;

  const heartbeat = setInterval(() => {
    send({
      t: "awareness",
      from: doc.clientID,
      data: encodeAwarenessUpdate(awareness, [awareness.clientID]),
    });
  }, HEARTBEAT_MS);

  const sweep = setInterval(() => {
    const now = Date.now();
    const stale: number[] = [];
    for (const [clientId, seen] of peers) {
      if (now - seen > PEER_TIMEOUT_MS) stale.push(clientId);
    }
    if (stale.length === 0) return;
    for (const clientId of stale) peers.delete(clientId);
    removeAwarenessStates(awareness, stale, "remote");
    emitPeers();
  }, 1000);

  send({ t: "hello", from: doc.clientID });

  return {
    setLatency(ms: number) {
      latency = ms;
    },
    setOffline(value: boolean) {
      offline = value;
      if (value) return;
      const queued = buffer.splice(0);
      for (const msg of queued) send(msg);
    },
    waitForState(ms: number) {
      if (gotState) return Promise.resolve(true);
      return new Promise((resolve) => {
        let timer: ReturnType<typeof setTimeout>;
        const finish = (value: boolean) => {
          clearTimeout(timer);
          resolve(value);
        };
        timer = setTimeout(() => {
          const index = waiters.indexOf(finish);
          if (index >= 0) waiters.splice(index, 1);
          resolve(false);
        }, ms);
        waiters.push(finish);
      });
    },
    onPeers(cb) {
      peersCb = cb;
      cb([...peers.keys()]);
    },
    destroy() {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      clearInterval(sweep);
      doc.off("update", onDoc);
      awareness.off("update", onAwareness as (event: unknown) => void);
      resolveWaiters(false);
      channel.postMessage({ t: "bye", from: doc.clientID, clients: [awareness.clientID] });
      awareness.destroy();
      channel.close();
    },
  };
}

function copyMsg(msg: Msg): Msg {
  if (msg.t === "hello" || msg.t === "bye") return msg;
  return { ...msg, data: new Uint8Array(msg.data) };
}
