import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";
import * as Y from "yjs";
import { TooltipProvider } from "@/ui/tooltip";
import { NoteDetailView } from "../src/note-detail-view";
import { NoteCollabYDocProvider } from "../src/use-note-title-field";

import "@/notes-core/src/notes-workspace.css";
import "@/note-detail-view/src/note-text-editor-body.css";

/** Title bound to the note document, seeded from stored SUMMARY. */
function TitleBoundToDoc() {
  const [ydoc] = useState(() => {
    const doc = new Y.Doc();
    doc.getXmlFragment("default");
    return doc;
  });

  return (
    <NoteCollabYDocProvider ydoc={ydoc}>
      <NoteDetailView
        noteId="title-in-doc"
        tags={[]}
        showTags={false}
        title="Event"
        storedTitle="Event"
        body={["# Other", "Notes"]}
        onTitleChange={() => {}}
      />
    </NoteCollabYDocProvider>
  );
}

const meta: Meta<typeof TitleBoundToDoc> = {
  title: "Features/Notes/Note Title In Document",
  component: TitleBoundToDoc,
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
type Story = StoryObj<typeof TitleBoundToDoc>;

/** A note without a document title opens with its stored SUMMARY. */
export const SeededFromSummary: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => {
      const title = canvas.getByRole("textbox", { name: "Title" }) as HTMLTextAreaElement;
      expect(title.value).toBe("Event");
    });
  },
};
