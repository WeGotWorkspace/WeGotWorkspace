import { useEffect, useRef, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";
import * as awarenessProtocol from "y-protocols/awareness";
import * as Y from "yjs";
import { TooltipProvider } from "@/ui/tooltip";
import { writeNoteTitle } from "@/text-editor-core/docs-collab/docs-collab-document-title";
import {
  NOTE_TITLE_SELECTION_FIELD,
  encodeTitleSelection,
  type RemoteTitleCaret,
} from "@/text-editor-core/docs-collab/docs-collab-title-selection";
import { NoteDetailView } from "../src/note-detail-view";
import { NoteTitleCarets, NoteTitleCaretsLayer } from "../src/note-title-carets";
import { NoteCollabYDocProvider } from "../src/use-note-title-field";

import "@/notes-core/src/notes-workspace.css";
import "@/note-detail-view/src/note-detail-view.css";
import "@/note-detail-view/src/note-text-editor-body.css";

type CaretAt = { name: string; color: string; index: number };

/** The note title textarea with remote carets at fixed indexes. */
function TitleWithCarets({ title, carets }: { title: string; carets: CaretAt[] }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const remote: RemoteTitleCaret[] = carets.map((caret, index) => ({
    clientId: index + 2,
    name: caret.name,
    color: caret.color,
    anchor: caret.index,
    head: caret.index,
  }));
  return (
    <article className="note-detail-view paper-sheet">
      <div className="note-detail-view__title-field">
        <textarea
          ref={textareaRef}
          aria-label="Title"
          className="note-detail-view__title"
          value={title}
          rows={3}
          readOnly
        />
        <NoteTitleCaretsLayer textareaRef={textareaRef} carets={remote} value={title} />
      </div>
    </article>
  );
}

/**
 * A full note detail bound to a Y.Doc, with a second participant's awareness
 * relayed in, as the mesh would. Grace's caret sits after "Weekly".
 */
function NoteWithRemoteParticipant() {
  const [session] = useState(() => {
    const local = new Y.Doc();
    writeNoteTitle(local, "Weekly planning");
    const awareness = new awarenessProtocol.Awareness(local);
    awareness.setLocalStateField("user", { name: "Ada", color: "#2563eb" });
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(local));
    const remoteAwareness = new awarenessProtocol.Awareness(remote);
    remoteAwareness.setLocalStateField("user", { name: "Grace", color: "#9333ea" });
    remoteAwareness.setLocalStateField(
      NOTE_TITLE_SELECTION_FIELD,
      encodeTitleSelection(remote, { anchor: 6, head: 6 }),
    );
    return { local, awareness, remoteAwareness };
  });

  useEffect(() => {
    const { awareness, remoteAwareness } = session;
    const update = awarenessProtocol.encodeAwarenessUpdate(remoteAwareness, [
      remoteAwareness.clientID,
    ]);
    awarenessProtocol.applyAwarenessUpdate(awareness, update, "mesh");
  }, [session]);

  return (
    <NoteCollabYDocProvider ydoc={session.local} awareness={session.awareness} localUserName="Ada">
      <NoteDetailView
        noteId="title-carets"
        tags={[]}
        showTags={false}
        title="Weekly planning"
        body={["Agenda"]}
        onTitleChange={() => {}}
      />
    </NoteCollabYDocProvider>
  );
}

const meta: Meta<typeof NoteTitleCarets> = {
  title: "Features/Notes/Note Title Carets",
  component: NoteTitleCarets,
  tags: ["vitest-ci"],
  decorators: [
    (Story) => (
      <TooltipProvider delayDuration={150}>
        <div className="notes-workspace notes-story-scope notes-story-scope--detail">
          <div className="notes-story-scope__detail-body mx-auto max-w-3xl px-6 py-10">
            <Story />
          </div>
        </div>
      </TooltipProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof NoteTitleCarets>;

function caretBoxes(canvasElement: HTMLElement): Map<string, DOMRect> {
  const boxes = new Map<string, DOMRect>();
  for (const caret of canvasElement.querySelectorAll<HTMLElement>(".note-title-carets__caret")) {
    boxes.set(caret.textContent ?? "", caret.getBoundingClientRect());
  }
  return boxes;
}

/** Carets drawn from fixed pixel positions, for the look alone. */
export const Marks: Story = {
  args: {
    carets: [
      { id: 2, name: "Grace", color: "#9333ea", left: 96, top: 0, height: 47 },
      { id: 3, name: "Linus", color: "#16a34a", left: 260, top: 47, height: 47 },
    ],
  },
  render: (args) => (
    <div className="note-detail-view__title-field" style={{ height: 120 }}>
      <NoteTitleCarets {...args} />
    </div>
  ),
};

/** Two participants in one title; carets land on their letters. */
export const TwoParticipants: Story = {
  render: () => (
    <TitleWithCarets
      title="Quarterly planning notes"
      carets={[
        { name: "Grace", color: "#9333ea", index: 0 },
        { name: "Linus", color: "#16a34a", index: 10 },
      ]}
    />
  ),
  play: async ({ canvasElement }) => {
    const title = within(canvasElement).getByRole("textbox", { name: "Title" });
    await waitFor(() => expect(caretBoxes(canvasElement).size).toBe(2));
    const overlay = canvasElement.querySelector(".note-title-carets");
    await expect(overlay).toHaveAttribute("aria-hidden", "true");
    const boxes = caretBoxes(canvasElement);
    const grace = boxes.get("Grace")!;
    const linus = boxes.get("Linus")!;
    const field = title.getBoundingClientRect();
    await expect(Math.abs(grace.left + grace.width / 2 - field.left)).toBeLessThan(3);
    await expect(linus.left).toBeGreaterThan(grace.left + 100);
    await expect(Math.abs(linus.top - grace.top)).toBeLessThan(1);
  },
};

/** A caret in a title that wraps sits on the wrapped line. */
export const WrappedTitle: Story = {
  render: () => (
    <div style={{ width: 280 }}>
      <TitleWithCarets
        title="A long note title that wraps onto a second line"
        carets={[
          { name: "Grace", color: "#9333ea", index: 0 },
          { name: "Linus", color: "#16a34a", index: 46 },
        ]}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(caretBoxes(canvasElement).size).toBe(2));
    const boxes = caretBoxes(canvasElement);
    await expect(boxes.get("Linus")!.top).toBeGreaterThan(boxes.get("Grace")!.top + 20);
  },
};

/** No remote participant in the title: nothing is drawn. */
export const NobodyInTitle: Story = {
  render: () => <TitleWithCarets title="Quarterly planning notes" carets={[]} />,
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector(".note-title-carets")).toBeNull();
  },
};

/** Note detail with a second participant typing in the title. */
export const RemoteParticipantInNote: Story = {
  render: () => <NoteWithRemoteParticipant />,
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(caretBoxes(canvasElement).has("Grace")).toBe(true));
    const title = within(canvasElement).getByRole("textbox", { name: "Title" });
    const field = title.getBoundingClientRect();
    const grace = caretBoxes(canvasElement).get("Grace")!;
    await expect(grace.left).toBeGreaterThan(field.left + 20);
    await expect(grace.left).toBeLessThan(field.right);
  },
};
