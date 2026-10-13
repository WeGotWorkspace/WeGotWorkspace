import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { parse } from "../ycsv-core/parse";
import { serialize } from "../ycsv-core/serialize";
import { Grid } from "../ycsv-grid/Grid";
import { docToFile, fileToDoc } from "../ycsv-model";
import { SEED } from "./fixtures";
import { link, type Link } from "./relay";

type Session = {
  docA: Y.Doc;
  docB: Y.Doc;
  aw: Awareness;
  bw: Awareness;
  connection: Link;
};

const userA = { id: "wouter", name: "Wouter", color: "#2e7d32" };
const userB = { id: "priya", name: "Priya", color: "#1565c0" };

function createSession(latency: number): Session {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  fileToDoc(parse(SEED), docA);
  const aw = new Awareness(docA);
  const bw = new Awareness(docB);
  const connection = link(docA, docB, aw, bw);
  connection.setLatency(latency);
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA), "remote");
  return { docA, docB, aw, bw, connection };
}

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

function CollabStory({ latency }: { latency: number }) {
  const [session] = useState(() => createSession(latency));
  const [offlineA, setOfflineA] = useState(false);
  const [offlineB, setOfflineB] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  const [previous, setPrevious] = useState<string | null>(null);

  useEffect(() => {
    session.connection.setLatency(latency);
  }, [latency, session]);

  useEffect(() => {
    return () => {
      session.connection.destroy();
      session.aw.destroy();
      session.bw.destroy();
    };
  }, [session]);

  useEffect(() => {
    session.connection.setOffline("a", offlineA);
  }, [offlineA, session]);

  useEffect(() => {
    session.connection.setOffline("b", offlineB);
  }, [offlineB, session]);

  const diff = shown !== null && previous !== null ? lineDiff(previous, shown) : null;

  return (
    <div style={{ padding: 16, fontFamily: "sans-serif" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <section>
          <header style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <strong style={{ color: userA.color }}>{userA.name}</strong>
            <label>
              <input type="checkbox" checked={offlineA} onChange={(event) => setOfflineA(event.target.checked)} />{" "}
              Offline
            </label>
          </header>
          <Grid doc={session.docA} awareness={session.aw} user={userA} />
        </section>
        <section>
          <header style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <strong style={{ color: userB.color }}>{userB.name}</strong>
            <label>
              <input type="checkbox" checked={offlineB} onChange={(event) => setOfflineB(event.target.checked)} />{" "}
              Offline
            </label>
          </header>
          <Grid doc={session.docB} awareness={session.bw} user={userB} />
        </section>
      </div>
      <div style={{ marginTop: 16 }}>
        <button
          type="button"
          onClick={() => {
            const text = serialize(docToFile(session.docA));
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
  args: { latency: 150 },
  argTypes: {
    latency: { control: { type: "number", min: 0, max: 2000 } },
  },
  render: (args) => <CollabStory latency={args.latency} />,
} satisfies Meta<{ latency: number }>;

export default meta;

type Story = StoryObj<typeof meta>;

export const TweeGebruikers: Story = {
  name: "Twee gebruikers",
};
