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

/** `index` is the caret (head); `anchor` starts a selection that ends there. */
type CaretAt = { name: string; color: string; index: number; anchor?: number };

/** The note title textarea with remote carets at fixed indexes. */
function TitleWithCarets({ title, carets }: { title: string; carets: CaretAt[] }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const remote: RemoteTitleCaret[] = carets.map((caret, index) => ({
    clientId: index + 2,
    name: caret.name,
    color: caret.color,
    anchor: caret.anchor ?? caret.index,
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
 * relayed in, as the mesh would. Grace's caret sits after "Weekly"; with
 * `selectFrom`, her selection starts there.
 */
function NoteWithRemoteParticipant({ selectFrom = 6 }: { selectFrom?: number }) {
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
      encodeTitleSelection(remote, { anchor: selectFrom, head: 6 }),
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

/** Selection boxes per participant name, in drawing order. */
function selectionBoxes(canvasElement: HTMLElement, name: string): DOMRect[] {
  return [
    ...canvasElement.querySelectorAll<HTMLElement>(
      `.note-title-carets__selection[data-name="${name}"]`,
    ),
  ].map((box) => box.getBoundingClientRect());
}

/** Carets and a selection drawn from fixed pixel positions, for the look alone. */
export const Marks: Story = {
  args: {
    carets: [
      {
        id: 2,
        name: "Grace",
        color: "#9333ea",
        left: 96,
        top: 0,
        height: 47,
        selections: [{ left: 0, top: 0, width: 96, height: 47 }],
      },
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
    // A caret without a selection draws no highlight.
    await expect(canvasElement.querySelector(".note-title-carets__selection")).toBeNull();
  },
};

/** A selection in the title is highlighted in the author's color, like the body. */
export const SelectionInTitle: Story = {
  render: () => (
    <TitleWithCarets
      title="Quarterly planning notes"
      carets={[{ name: "Grace", color: "#9333ea", anchor: 0, index: 9 }]}
    />
  ),
  play: async ({ canvasElement }) => {
    const title = within(canvasElement).getByRole("textbox", { name: "Title" });
    await waitFor(() => expect(selectionBoxes(canvasElement, "Grace")).toHaveLength(1));
    const [selection] = selectionBoxes(canvasElement, "Grace");
    const caret = caretBoxes(canvasElement).get("Grace")!;
    const field = title.getBoundingClientRect();
    // "Quarterly": from the start of the title to the caret, on the caret's line.
    await expect(Math.abs(selection!.left - field.left)).toBeLessThan(3);
    await expect(Math.abs(selection!.right - (caret.left + caret.width / 2))).toBeLessThan(3);
    await expect(selection!.width).toBeGreaterThan(40);
    await expect(Math.abs(selection!.top - caret.top)).toBeLessThan(1);
    await expect(Math.abs(selection!.height - caret.height)).toBeLessThan(1);
    // Same look as the body's remote selection (`.collaboration-carets__selection`).
    const box = canvasElement.querySelector<HTMLElement>(".note-title-carets__selection")!;
    await expect(getComputedStyle(box).opacity).toBe("0.25");
    await expect(getComputedStyle(box).backgroundColor).toBe("rgb(147, 51, 234)");
  },
};

/** A selection made backwards (head before anchor) covers the same text. */
export const BackwardSelection: Story = {
  render: () => (
    <TitleWithCarets
      title="Quarterly planning notes"
      carets={[{ name: "Grace", color: "#9333ea", anchor: 9, index: 0 }]}
    />
  ),
  play: async ({ canvasElement }) => {
    const title = within(canvasElement).getByRole("textbox", { name: "Title" });
    await waitFor(() => expect(selectionBoxes(canvasElement, "Grace")).toHaveLength(1));
    const [selection] = selectionBoxes(canvasElement, "Grace");
    const caret = caretBoxes(canvasElement).get("Grace")!;
    const field = title.getBoundingClientRect();
    await expect(Math.abs(selection!.left - field.left)).toBeLessThan(3);
    await expect(selection!.width).toBeGreaterThan(40);
    // The caret sits at the head, the start of the selection.
    await expect(Math.abs(caret.left + caret.width / 2 - field.left)).toBeLessThan(3);
  },
};

/** A selection across a wrapped line is highlighted on both lines. */
export const SelectionAcrossWrappedLines: Story = {
  render: () => (
    <div style={{ width: 280 }}>
      <TitleWithCarets
        title="A long note title that wraps onto a second line"
        carets={[{ name: "Grace", color: "#9333ea", anchor: 2, index: 46 }]}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(selectionBoxes(canvasElement, "Grace").length).toBeGreaterThanOrEqual(2),
    );
    const boxes = selectionBoxes(canvasElement, "Grace");
    const first = boxes[0]!;
    const last = boxes.at(-1)!;
    await expect(last.top).toBeGreaterThan(first.top + 20);
    // The highlight on the last line ends at the caret.
    const caret = caretBoxes(canvasElement).get("Grace")!;
    await expect(Math.abs(last.top - caret.top)).toBeLessThan(1);
    await expect(Math.abs(last.right - (caret.left + caret.width / 2))).toBeLessThan(3);
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

/** Note detail with a second participant who selected "Weekly" in the title. */
export const RemoteSelectionInNote: Story = {
  render: () => <NoteWithRemoteParticipant selectFrom={0} />,
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(selectionBoxes(canvasElement, "Grace")).toHaveLength(1));
    const title = within(canvasElement).getByRole("textbox", { name: "Title" });
    const field = title.getBoundingClientRect();
    const [selection] = selectionBoxes(canvasElement, "Grace");
    const grace = caretBoxes(canvasElement).get("Grace")!;
    await expect(Math.abs(selection!.left - field.left)).toBeLessThan(3);
    await expect(Math.abs(selection!.right - (grace.left + grace.width / 2))).toBeLessThan(3);
  },
};
