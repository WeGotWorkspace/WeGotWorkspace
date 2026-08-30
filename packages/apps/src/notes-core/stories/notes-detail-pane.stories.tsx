import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
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
  const [tags, setTags] = useState(base.tags);

  return (
    <NotesStoryScope variant="detail">
      <div className="notes-workspace flex min-h-dvh flex-col">
        <div className="workspace-detail-pane__scroll flex-1">
          <NoteDetailView
            noteId={base.noteId}
            contentRevision={base.lastEdited}
            title={base.title}
            onTitleChange={readOnly ? undefined : () => {}}
            tags={tags}
            availableTags={base.tags}
            onTagAdd={
              readOnly ? undefined : (label) => setTags((prev) => [...prev, label])
            }
            onTagRemove={
              readOnly ? undefined : (label) => setTags((prev) => prev.filter((tag) => tag !== label))
            }
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

    const remove = canvasElement.querySelector(
      '.note-detail-view__tag-group .tag__remove',
    ) as HTMLButtonElement | null;
    expect(remove).toBeTruthy();
    const workspace = canvasElement.querySelector(".notes-workspace");
    expect(workspace).toBeTruthy();
    const probe = document.createElement("span");
    probe.style.color = "var(--notes-tag-selected-fg)";
    workspace!.appendChild(probe);
    expect(getComputedStyle(remove!).color).toBe(getComputedStyle(probe).color);
    probe.remove();

    const label = remove!.getAttribute("aria-label") ?? "";
    const tagLabel = label.replace(/^Remove tag /, "");
    await userEvent.click(remove!);
    await waitFor(() => {
      expect(canvasElement.querySelector(`[aria-label="Remove tag ${tagLabel}"]`)).toBeNull();
    });

    const edited = canvasElement.querySelector(
      ".notes-detail-footer__meta-tag--edited",
    ) as HTMLElement | null;
    expect(edited).toBeTruthy();
    expect(edited!.textContent).toMatch(/Last edited/);
    const chip = edited!.querySelector(".tag") as HTMLElement | null;
    expect(chip).toBeTruthy();
    const chipStyle = getComputedStyle(chip!);
    expect(chipStyle.display).not.toBe("none");
    expect(chipStyle.visibility).not.toBe("hidden");
    expect(Number.parseFloat(chipStyle.opacity || "1")).toBeGreaterThan(0);
    const rect = chip!.getBoundingClientRect();
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.height).toBeGreaterThan(0);
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

    const workspace = canvasElement.querySelector(".notes-workspace");
    const chip = canvasElement.querySelector(".note-detail-view__tag-group .tag");
    expect(workspace).toBeTruthy();
    expect(chip).toBeTruthy();
    const probe = document.createElement("span");
    probe.style.backgroundColor = "var(--notes-tag-selected-bg)";
    probe.style.color = "var(--notes-tag-selected-fg)";
    probe.style.borderColor = "var(--notes-tag-selected-border)";
    workspace!.appendChild(probe);
    const chipStyle = getComputedStyle(chip!);
    const probeStyle = getComputedStyle(probe);
    expect(chipStyle.backgroundColor).toBe(probeStyle.backgroundColor);
    expect(chipStyle.color).toBe(probeStyle.color);
    expect(chipStyle.borderColor).toBe(probeStyle.borderColor);
    probe.remove();
  },
};

export const WithPullQuote: Story = {
  args: { withPullQuote: true },
};

export const TallScroll: Story = {
  args: { tallBody: true },
};
