import { useEffect, useMemo, useRef, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { parse } from "../ycsv-core/parse";
import { serialize } from "../ycsv-core/serialize";
import { Grid } from "../ycsv-grid/Grid";
import { docToFile, fileToDoc } from "../ycsv-model";
import { connect, type Conn } from "./channel";
import { SEED } from "./fixtures";
import { identity } from "./identity";

const ROOM = "ycsv-proto";

type Session = {
  doc: Y.Doc;
  awareness: Awareness;
  conn: Conn;
};

function lineDiff(before: string, after: string): { text: string; changed: number } {
  const left = before.split("\n");
  const right = after.split("\n");
  const count = Math.max(left.length, right.length);
  const lines: string[] = [];
  let changed = 0;
  for (let i = 0; i < count; i += 1) {
    if (left[i] === right[i]) continue;
    changed += 1;
    if (left[i] !== undefined) lines.push(`-${left[i]}`);
    if (right[i] !== undefined) lines.push(`+${right[i]}`);
  }
  return { text: lines.join("\n"), changed };
}

function SheetStory({ latency }: { latency: number }) {
  const latencyRef = useRef(latency);
  latencyRef.current = latency;
  const connRef = useRef<Conn | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [peerIds, setPeerIds] = useState<number[]>([]);
  const [name, setName] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  const [previous, setPrevious] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const onUnload = () => {
      cancelled = true;
      connRef.current?.destroy();
    };
    window.addEventListener("beforeunload", onUnload);

    const run = async () => {
      let current: Session | null = null;
      // Hello stays inside the lock so a second tab cannot answer with an empty document.
      await navigator.locks.request(`${ROOM}:seed`, async () => {
        if (cancelled) return;
        const doc = new Y.Doc();
        const awareness = new Awareness(doc);
        const conn = connect(doc, awareness, ROOM);
        current = { doc, awareness, conn };
        connRef.current = conn;
        conn.setLatency(latencyRef.current);
        conn.onPeers((ids) => {
          if (!cancelled) setPeerIds(ids);
        });
        const synced = await conn.waitForState(400);
        if (cancelled) return;
        if (!synced && doc.getArray("rows").length === 0) {
          fileToDoc(parse(SEED), doc);
        }
      });
      if (!cancelled && current) setSession(current);
    };

    void run();
    return () => {
      cancelled = true;
      window.removeEventListener("beforeunload", onUnload);
      connRef.current?.destroy();
      connRef.current = null;
    };
  }, []);

  useEffect(() => {
    session?.conn.setLatency(latency);
  }, [latency, session]);

  useEffect(() => {
    session?.conn.setOffline(offline);
  }, [offline, session]);

  const me = useMemo(() => (session ? identity(session.doc.clientID) : null), [session]);
  const shownName = name ?? me?.name ?? "";
  const user = useMemo(() => {
    if (!me) return null;
    return { id: me.id, name: shownName, color: me.color };
  }, [me, shownName]);

  const diff = shown !== null && previous !== null ? lineDiff(previous, shown) : null;
  const tabs = peerIds.length + (session ? 1 : 0);

  return (
    <div style={{ padding: 16, fontFamily: "sans-serif" }}>
      <header style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 8 }}>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: 999,
              background: user?.color ?? "#999",
              display: "inline-block",
            }}
          />
          <input
            aria-label="Naam"
            value={shownName}
            disabled={!session}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <span>{tabs} tabs verbonden</span>
        <label>
          <input
            type="checkbox"
            checked={offline}
            disabled={!session}
            onChange={(event) => setOffline(event.target.checked)}
          />{" "}
          Offline
        </label>
      </header>
      {session && user ? <Grid doc={session.doc} awareness={session.awareness} user={user} /> : null}
      <div style={{ marginTop: 16 }}>
        <button
          type="button"
          disabled={!session}
          onClick={() => {
            if (!session) return;
            const text = serialize(docToFile(session.doc));
            setPrevious(shown);
            setShown(text);
          }}
        >
          Toon .ycsv
        </button>
        {shown !== null ? <pre>{shown}</pre> : null}
        {diff ? (
          <pre>
            {diff.changed} {diff.changed === 1 ? "line" : "lines"} changed{"\n"}
            {diff.text}
          </pre>
        ) : shown !== null ? (
          <pre>No previous snapshot.</pre>
        ) : null}
      </div>
    </div>
  );
}

const meta = {
  title: "YCSV/Collab",
  args: { latency: 0 },
  argTypes: {
    latency: { control: { type: "number", min: 0, max: 2000 } },
  },
  render: (args) => <SheetStory latency={args.latency} />,
} satisfies Meta<{ latency: number }>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Sheet: Story = {
  name: "Sheet",
};
