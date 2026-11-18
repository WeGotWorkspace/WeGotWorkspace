import type { Meta, StoryObj } from "@storybook/react-vite";
import { useMemo } from "react";
import { expect, within } from "storybook/test";
import { ThreadPanel } from "@/thread-ui/src/thread-panel";
import { threadUiLabels } from "@/thread-ui/src/thread-labels";
import { createThreadMemoryClient } from "@/thread-ui/src/thread-memory-client";
import type { ThreadEntry, ThreadSubjectAdapter } from "@/lib/models/thread-types";

const me = { id: "wouter", displayName: "Wouter Vroege" };
const lisa = { id: "lisa", displayName: "Lisa van Dijk" };
const people = [me, lisa];
const subject = { type: "story", id: "s1" };

function entry(id: string, minutesAgo: number, overrides: Partial<ThreadEntry>): ThreadEntry {
  return {
    id,
    kind: "comment",
    parentId: null,
    author: { username: lisa.id, displayName: lisa.displayName },
    body: "",
    mentions: [],
    reactions: [],
    createdAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    editedAt: null,
    deletedAt: null,
    activity: null,
    ...overrides,
  };
}

const BUSY: ThreadEntry[] = [
  entry("01J6Y6M0R2V9GKJ4W1T8Q30001", 120, {
    body: "Vergeet de havermelk niet, er staat er nog maar één in de voorraadkast.",
    reactions: [{ emoji: "👍", authors: [me.id] }],
  }),
  entry("01J6Y6M0R2V9GKJ4W1T8Q30002", 45, {
    kind: "reply",
    parentId: "01J6Y6M0R2V9GKJ4W1T8Q30001",
    author: { username: me.id, displayName: me.displayName },
    body: "Staat genoteerd! Ik neem meteen twee pakken mee.",
  }),
  entry("01J6Y6M0R2V9GKJ4W1T8Q30003", 30, { body: null, deletedAt: new Date().toISOString() }),
  entry("01J6Y6M0R2V9GKJ4W1T8Q30004", 10, {
    body: "@Wouter Vroege kun je ook **brood** halen? <img src=x onerror=alert(1)> blijft tekst.",
    mentions: [{ id: me.id, displayName: me.displayName }],
  }),
];

function Harness({ entries, canPost }: { entries: ThreadEntry[]; canPost: boolean }) {
  const client = useMemo(() => {
    const memory = createThreadMemoryClient(me, people);
    memory.seed(subject, entries);
    memory.setCanPost(subject, canPost);
    return memory;
  }, [entries, canPost]);
  const adapter: ThreadSubjectAdapter = { subject, scopeId: "list-1", canPost, people, me };
  return (
    <div style={{ maxWidth: 720, padding: 24 }}>
      <ThreadPanel client={client} adapter={adapter} />
    </div>
  );
}

const meta = {
  title: "Threads/ThreadPanel",
  component: Harness,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Harness>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  args: { entries: [], canPost: true },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText(threadUiLabels.empty)).toBeTruthy();
  },
};

export const Busy: Story = { args: { entries: BUSY, canPost: true } };

export const ReadOnly: Story = {
  args: { entries: BUSY, canPost: false },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText(threadUiLabels.readOnly)).toBeTruthy();
  },
};
