import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { Star } from "lucide-react";
import { ActionBar } from "@/action-bar/src/action-bar";
import { DocsCollabPresence } from "@/text-editor-core/docs-collab/docs-collab-presence";
import { TooltipProvider } from "@/ui/tooltip";
import { NoteDetailView } from "../src/note-detail-view";
import { NotesDetailFooter } from "@/notes-core/src/notes-detail-footer";

import "@/notes-core/src/notes-workspace.css";

const meta: Meta<typeof NoteDetailView> = {
  title: "Apps/Notes/Note Detail View",
  component: NoteDetailView,
  decorators: [
    (Story) => (
      <TooltipProvider delayDuration={150}>
        <div className="notes-workspace notes-story-scope notes-story-scope--detail">
          <div className="notes-story-scope__detail-body mx-auto max-w-3xl px-6 py-10 md:px-12 md:py-16">
            <Story />
          </div>
        </div>
      </TooltipProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof NoteDetailView>;

const base = {
  noteId: "demo-1",
  contentRevision: "6 May 2026",
  title: "Endless scroll",
  onTitleChange: () => {},
  tags: ["ideas", "draft"],
  availableTags: ["ideas", "draft", "focus", "shipping"],
  body: ["First paragraph of the note.", "Second paragraph with more detail."],
  onTagAdd: () => {},
  onTagRemove: () => {},
};

export const Editable: Story = {
  args: {
    ...base,
    readOnly: false,
    pullQuote: "A quote pulled from the body.",
  },
};

/** Empty SUMMARY — document-title scale, not a tiny form input. */
export const EmptyTitle: Story = {
  tags: ["vitest-ci"],
  args: {
    ...base,
    title: "",
    pullQuote: undefined,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("textbox", { name: "Title" }) as HTMLInputElement;
    expect(input.classList.contains("note-detail-view__title")).toBe(true);
    expect(input.placeholder).toBe("Title");
  },
};

export const ReadOnly: Story = {
  args: {
    ...base,
    readOnly: true,
    pullQuote: undefined,
  },
};

/** Static layout preview: presence in the action bar, meta in the pinned footer. */
export const CollabChromePreview: Story = {
  render: () => (
    <div className="notes-workspace notes-story-scope notes-story-scope--detail flex min-h-[24rem] flex-col">
      <ActionBar
        onBack={() => {}}
        rightLeading={
          <div className="note-detail-view__collab-chrome">
            <DocsCollabPresence
              localUser={{ displayName: "Alex Example" }}
              peers={[
                { id: "peer-1", name: "Sam Lee" },
                { id: "peer-2", name: "Jordan Kim" },
              ]}
              connectingPeers={[{ id: "peer-3", name: "Casey Wu" }]}
            />
          </div>
        }
        rightActions={[
          {
            id: "star",
            label: "Star",
            icon: <Star />,
            onClick: () => {},
          },
        ]}
      />
      <div className="workspace-detail-pane__scroll flex-1">
        <article className="note-detail-view max-w-[680px] mx-auto">
          <p className="text-muted-foreground text-sm">
            Collab session chrome preview — presence sits in the action bar; edited meta pins in the
            footer.
          </p>
        </article>
      </div>
      <NotesDetailFooter lastEdited="6 May 2026" />
    </div>
  ),
};
