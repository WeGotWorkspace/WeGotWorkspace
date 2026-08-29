import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor } from "storybook/test";
import { NoteDetailView } from "@/note-detail-view/src/note-detail-view";
import { NotesDetailFooter } from "@/notes-core/src/notes-detail-footer";
import { getNotesDetailStoryProps } from "./notes-pane-stories.fixtures";
import { NotesStoryScope } from "./notes-story-scope";

function NotesDetailPaneHarness({
  readOnly = false,
  withPullQuote = false,
  tallBody = false,
}: {
  readOnly?: boolean;
  withPullQuote?: boolean;
  tallBody?: boolean;
}) {
  const base = getNotesDetailStoryProps({
    extraBody: tallBody,
    pullQuote: withPullQuote ? "A highlighted line for layout checks." : undefined,
  });

  return (
    <NotesStoryScope variant="detail">
      <div className="notes-workspace flex min-h-dvh flex-col">
        <div className="workspace-detail-pane__scroll flex-1">
          <NoteDetailView
            noteId={base.noteId}
            contentRevision={base.lastEdited}
            title={base.title}
            onTitleChange={readOnly ? undefined : () => {}}
            tags={base.tags}
            readOnly={readOnly}
            pullQuote={base.pullQuote}
            body={base.body}
          />
        </div>
        <NotesDetailFooter lastEdited={base.lastEdited} editedLabel={base.editedLabel} />
      </div>
    </NotesStoryScope>
  );
}

const meta = {
  title: "Apps/Notes/Panes/Detail",
  component: NotesDetailPaneHarness,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof NotesDetailPaneHarness>;

export default meta;
type Story = StoryObj<typeof NotesDetailPaneHarness>;

export const Editable: Story = {
  tags: ["vitest-ci"],
  args: {},
  play: async ({ canvasElement }) => {
    const editor = canvasElement.querySelector('[contenteditable="true"]');
    expect(editor).toBeTruthy();
    await userEvent.click(editor!);
    await userEvent.type(editor!, " Updated body text");
    await waitFor(() => {
      expect(editor!.textContent).toMatch(/Updated body text/);
    });
  },
};

export const ReadOnly: Story = {
  tags: ["vitest-ci"],
  args: { readOnly: true },
  play: async ({ canvasElement }) => {
    const editable = canvasElement.querySelector('[contenteditable="true"]');
    expect(editable).toBeNull();
    const locked = canvasElement.querySelector('[contenteditable="false"]');
    expect(locked).toBeTruthy();
  },
};

export const WithPullQuote: Story = {
  args: { withPullQuote: true },
};

export const TallScroll: Story = {
  args: { tallBody: true },
};
