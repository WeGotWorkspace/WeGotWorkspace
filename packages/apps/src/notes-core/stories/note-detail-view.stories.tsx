import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { Star } from "lucide-react";
import { ActionBar } from "@/action-bar/src/action-bar";
import { DocsCollabPresenceChrome } from "@/text-editor-core/docs-collab/docs-collab-presence-chrome";
import { TooltipProvider } from "@/ui/tooltip";
import { NoteDetailView } from "@/note-detail-view/src/note-detail-view";
import { NotesDetailLastEdited } from "@/notes-core/src/notes-detail-last-edited";

import "@/notes-core/src/notes-workspace.css";
import "@/note-detail-view/src/note-text-editor-body.css";

const meta: Meta<typeof NoteDetailView> = {
  title: "Features/Notes/Note Detail View",
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

/** The notebook sits above the title (an eyebrow slot); the sheet has no tint. */
export const WithNotebookEyebrow: Story = {
  tags: ["vitest-ci"],
  args: {
    ...base,
    pullQuote: undefined,
    eyebrow: <span data-testid="eyebrow">The Journal</span>,
  },
  play: async ({ canvasElement }) => {
    const eyebrow = canvasElement.querySelector(".note-detail-view__eyebrow") as HTMLElement;
    await expect(eyebrow).toHaveTextContent("The Journal");
    const title = within(canvasElement).getByRole("textbox", { name: "Title" });
    await expect(
      eyebrow.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  },
};

export const Editable: Story = {
  args: {
    ...base,
    readOnly: false,
    pullQuote: "A quote pulled from the body.",
  },
};

/** Long wrapping SUMMARY — descenders (g, y) stay visible; no ellipsis. */
export const LongTitle: Story = {
  args: {
    ...base,
    title: "Typography going through wrapping titles and lengthy summaries",
    pullQuote: undefined,
    body: [
      "# Section heading",
      "## Subsection",
      "### Heading three",
      "First paragraph of the note.",
    ],
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
    const title = canvas.getByRole("textbox", { name: "Title" }) as HTMLTextAreaElement;
    expect(title.tagName).toBe("TEXTAREA");
    expect(title.classList.contains("note-detail-view__title")).toBe(true);
    expect(title.placeholder).toBe("Title");
  },
};

export const ReadOnly: Story = {
  args: {
    ...base,
    readOnly: true,
    pullQuote: undefined,
  },
};

/**
 * Collab layout: collaborator avatars in the action bar before the actions (the
 * Docs header look); the last-edited date beside the notebook; no footer.
 */
export const CollabChromePreview: Story = {
  render: () => (
    <div className="notes-workspace notes-story-scope notes-story-scope--detail flex min-h-[24rem] flex-col">
      <ActionBar
        onBack={() => {}}
        rightLeading={
          <DocsCollabPresenceChrome
            variant="header"
            localUser={{ displayName: "Alex Example" }}
            peers={[
              { id: "peer-1", name: "Sam Lee" },
              { id: "peer-2", name: "Jordan Kim" },
            ]}
            connectingPeers={[{ id: "peer-3", name: "Casey Wu" }]}
          />
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
        <NoteDetailView
          {...base}
          pullQuote={undefined}
          eyebrow={<NotesDetailLastEdited lastEdited="6 May 2026" editedLabel="Edited" />}
        />
      </div>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const presence = canvasElement.querySelector(
      ".action-bar .docs-collab-presence-chrome--header",
    );
    await expect(presence).toBeTruthy();
    // Round avatars, no people glyph (same as the Docs header).
    const glyph = presence!.querySelector(".docs-collab-presence-chrome__icon-trigger");
    await expect(getComputedStyle(glyph as HTMLElement).display).toBe("none");
    const mark = presence!.querySelector(".user-avatar__mark") as HTMLElement;
    await expect(mark.getBoundingClientRect().width).toBe(32);

    const edited = canvasElement.querySelector(
      ".note-detail-view__eyebrow .notes-detail-last-edited",
    );
    await expect(edited).toBeTruthy();
    await expect(edited!.querySelector(".tag")).toBeNull();
    await expect(edited).toHaveTextContent("|Edited 6 May 2026");
    await expect(canvasElement.querySelector(".workspace-detail-footer")).toBeNull();
  },
};

/**
 * A control before the title (Tasks puts its done box here): it sits left of the
 * title, on the title's first line, and the title keeps the rest of the width.
 */
export const WithTitleLeading: Story = {
  tags: ["vitest-ci"],
  args: {
    ...base,
    pullQuote: undefined,
    titleLeading: <input type="checkbox" aria-label="Done" className="size-6" />,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const leading = canvas.getByRole("checkbox", { name: "Done" });
    const title = canvas.getByRole("textbox", { name: "Title" });
    const leadingRect = leading.getBoundingClientRect();
    const titleRect = title.getBoundingClientRect();
    await expect(leadingRect.right).toBeLessThanOrEqual(titleRect.left);
    await expect(leadingRect.top).toBeGreaterThanOrEqual(titleRect.top);
    await expect(leadingRect.bottom).toBeLessThanOrEqual(
      titleRect.top + parseFloat(getComputedStyle(title).lineHeight),
    );
    await expect(title.closest(".note-detail-view__title-row")).toBeTruthy();
  },
};
