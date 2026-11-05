import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, waitFor } from "storybook/test";
import { withDarkTheme } from "@/branding-playground/dark-theme-story";
import { NoteDetailView } from "@/note-detail-view/src/note-detail-view";
import { NotesDetailLastEdited } from "@/notes-core/src/notes-detail-last-edited";
import { getNotesDetailStoryProps } from "./notes-pane-stories.fixtures";
import { NotesStoryScope } from "./notes-story-scope";
import "@/workspace-app/src/workspace-app.css";

/**
 * Editor task checks: the selection mark shape (empty ring, or one solid fill)
 * in the notebook colour, with a check in its contrast ink.
 */
async function expectNotebookTaskChecks(canvasElement: HTMLElement) {
  const box = (state: "true" | "false") =>
    canvasElement.querySelector<HTMLElement>(
      `ul[data-type="taskList"] li[data-checked="${state}"] > label span`,
    );
  await waitFor(() => expect(box("true")).toBeTruthy());
  const checked = box("true")!;
  const unchecked = box("false")!;
  const resolve = (value: string) => {
    const probe = document.createElement("span");
    probe.style.color = value;
    checked.parentElement!.appendChild(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  };
  const style = getComputedStyle(checked);
  expect(style.backgroundColor).toBe(resolve("var(--notes-detail-accent)"));
  expect(style.borderTopColor).toBe(style.backgroundColor);
  expect(style.color).toBe(
    resolve("var(--notes-detail-check-fg, var(--workspace-accent-foreground))"),
  );
  expect(style.color).not.toBe(style.backgroundColor);
  expect(getComputedStyle(checked, "::after").backgroundColor).toBe(style.color);
  expect(getComputedStyle(unchecked).backgroundColor).toBe("rgba(0, 0, 0, 0)");
}

function NotesDetailPaneHarness({
  readOnly = false,
  withPullQuote = false,
  tallBody = false,
  withTasks = false,
  detailTint,
}: {
  readOnly?: boolean;
  withPullQuote?: boolean;
  tallBody?: boolean;
  withTasks?: boolean;
  detailTint?: string;
}) {
  const base = getNotesDetailStoryProps({
    extraBody: tallBody,
    pullQuote: withPullQuote ? "A highlighted line for layout checks." : undefined,
  });
  const body = withTasks
    ? [...base.body, "- [ ] Unchecked next to tags\n- [x] Checked next to tags"]
    : base.body;
  const [tags, setTags] = useState(base.tags);

  return (
    <NotesStoryScope variant="detail" detailTint={detailTint}>
      <div className="notes-workspace flex min-h-dvh flex-col">
        <div className="workspace-detail-pane__scroll flex-1">
          <NoteDetailView
            noteId={base.noteId}
            contentRevision={base.lastEdited}
            title={base.title}
            onTitleChange={readOnly ? undefined : () => {}}
            tags={tags}
            availableTags={base.tags}
            onTagAdd={readOnly ? undefined : (label) => setTags((prev) => [...prev, label])}
            onTagRemove={
              readOnly
                ? undefined
                : (label) => setTags((prev) => prev.filter((tag) => tag !== label))
            }
            readOnly={readOnly}
            pullQuote={base.pullQuote}
            body={body}
            eyebrow={
              <NotesDetailLastEdited lastEdited={base.lastEdited} editedLabel={base.editedLabel} />
            }
          />
        </div>
      </div>
    </NotesStoryScope>
  );
}

/**
 * The open note's tags are active tags: the selected-sidebar-tag colours (ink
 * dimmed into the surface, surface label), not the notebook colour, no edge;
 * the label follows the chip ink.
 */
function expectActiveDetailTag(chip: HTMLElement, host: HTMLElement) {
  const probe = (value: string) => {
    const span = document.createElement("span");
    span.style.backgroundColor = value;
    host.appendChild(span);
    const color = getComputedStyle(span).backgroundColor;
    span.remove();
    return color;
  };
  const style = getComputedStyle(chip);
  expect(style.backgroundColor).toBe(probe("var(--notes-tag-active-bg)"));
  expect(style.backgroundColor).not.toBe(probe("var(--note-detail-tag-bg)"));
  expect(style.color).toBe(probe("var(--notes-tag-active-fg)"));
  expect(style.boxShadow).toBe("none");
  const label = chip.querySelector(".tag__label");
  expect(label).toBeTruthy();
  expect(getComputedStyle(label!).color).toBe(style.color);
}

const meta = {
  title: "Features/Notes/Panes/Detail",
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
    const sheet = canvasElement.querySelector(".paper-sheet");
    expect(sheet).toBeTruthy();
    expect(sheet!.querySelector(".note-detail-view__title")).toBeTruthy();
    expect(sheet!.querySelector(".note-detail-view__tag-group")).toBeTruthy();
    expect(sheet!.querySelector(".note-text-editor-body")).toBeTruthy();
    // No footer: the last-edited date sits above the title.
    expect(canvasElement.querySelector(".workspace-detail-footer")).toBeNull();

    const editor = canvasElement.querySelector('[contenteditable="true"]');
    expect(editor).toBeTruthy();
    await userEvent.click(editor!);
    await userEvent.type(editor!, " Updated body text");
    await waitFor(() => {
      expect(editor!.textContent).toMatch(/Updated body text/);
    });

    const remove = canvasElement.querySelector(
      ".note-detail-view__tag-group .tag__remove",
    ) as HTMLButtonElement | null;
    expect(remove).toBeTruthy();
    const workspace = canvasElement.querySelector(".notes-workspace");
    expect(workspace).toBeTruthy();
    expect(getComputedStyle(remove!).color).toBe(
      getComputedStyle(remove!.closest(".tag") as HTMLElement).color,
    );

    const label = remove!.getAttribute("aria-label") ?? "";
    const tagLabel = label.replace(/^Remove tag /, "");
    await userEvent.click(remove!);
    await waitFor(() => {
      expect(canvasElement.querySelector(`[aria-label="Remove tag ${tagLabel}"]`)).toBeNull();
    });

    // Last edited: plain text after a bar beside the notebook, not a chip.
    const edited = sheet!.querySelector(
      ".note-detail-view__eyebrow .notes-detail-last-edited",
    ) as HTMLElement | null;
    expect(edited).toBeTruthy();
    expect(edited!.querySelector(".tag")).toBeNull();
    expect(edited!.querySelector(".notes-detail-last-edited__separator")?.textContent).toBe("|");
    const date = edited!.querySelector(".notes-detail-last-edited__date") as HTMLElement;
    expect(date.textContent).toMatch(/\d/);
    expect(date.getBoundingClientRect().width).toBeGreaterThan(0);

    expect(
      getComputedStyle(workspace as HTMLElement)
        .getPropertyValue("--notes-detail-tint")
        .trim(),
    ).toBe("");
    const accentProbe = document.createElement("span");
    accentProbe.style.color = "var(--workspace-accent)";
    const darkProbe = document.createElement("span");
    darkProbe.style.color = "var(--color-we-got-dark)";
    workspace!.appendChild(accentProbe);
    workspace!.appendChild(darkProbe);
    expect(getComputedStyle(accentProbe).color).toBe(getComputedStyle(darkProbe).color);
    expect(getComputedStyle(accentProbe).color).not.toBe("rgb(0, 0, 0)");
    accentProbe.remove();
    darkProbe.remove();
  },
};

/** Tags are 30px chips right under the title; on touch the remove target grows invisibly to 44px. */
export const TouchSafeTags: Story = {
  tags: ["vitest-ci"],
  args: {},
  play: async ({ canvasElement }) => {
    const title = canvasElement.querySelector(".note-detail-view__title") as HTMLElement;
    const group = canvasElement.querySelector(".note-detail-view__tag-group") as HTMLElement;
    const chip = group.querySelector(".tag") as HTMLElement;
    const remove = chip.querySelector(".tag__remove") as HTMLElement;
    const chipBox = chip.getBoundingClientRect();
    await expect(Math.round(chipBox.height)).toBe(30);
    // The remove target spans the chip's full height and reaches its end edge.
    const removeBox = remove.getBoundingClientRect();
    await expect(removeBox.height).toBe(chipBox.height);
    await expect(removeBox.width).toBeGreaterThanOrEqual(30);
    await expect(Math.round(removeBox.right)).toBe(Math.round(chipBox.right));
    // Close under the title.
    const gap = group.getBoundingClientRect().top - title.getBoundingClientRect().bottom;
    await expect(gap).toBeLessThan(20);
  },
};

export const NotebookTint: Story = {
  tags: ["vitest-ci"],
  args: { detailTint: "#ec4899", withTasks: true },
  parameters: {
    // Desk pads + distinct sheet/scroll washes apply above the flush breakpoint.
    viewport: { value: "desktop", isRotated: false },
  },
  play: async ({ canvasElement }) => {
    const workspace = canvasElement.querySelector(".notes-workspace") as HTMLElement | null;
    expect(workspace).toBeTruthy();
    expect(getComputedStyle(workspace!).getPropertyValue("--notes-detail-tint").trim()).toBe(
      "oklch(from #ec4899 l c h)",
    );
    const sheet = canvasElement.querySelector(".paper-sheet") as HTMLElement | null;
    const scroll = canvasElement.querySelector(
      ".workspace-detail-pane__scroll",
    ) as HTMLElement | null;
    expect(sheet).toBeTruthy();
    expect(scroll).toBeTruthy();
    // The open note sits on the plain pane: no notebook wash on the sheet.
    const tintBg = document.createElement("span");
    tintBg.style.backgroundColor = "var(--notes-detail-tint)";
    workspace!.appendChild(tintBg);
    expect(getComputedStyle(sheet!).backgroundColor).toBe(
      getComputedStyle(scroll!).backgroundColor,
    );
    expect(getComputedStyle(sheet!).backgroundColor).not.toBe(
      getComputedStyle(tintBg).backgroundColor,
    );
    expect(getComputedStyle(sheet!).boxShadow).toBe("none");
    tintBg.remove();
    const chip = canvasElement.querySelector(
      ".note-detail-view__tag-group .tag",
    ) as HTMLElement | null;
    expect(chip).toBeTruthy();
    expectActiveDetailTag(chip!, workspace!);
    const sheetRect = sheet!.getBoundingClientRect();
    expect(getComputedStyle(sheet!).minHeight).not.toBe("100%");
    // Sheet grows with content; desk scrollport owns overflow (no sheet max-height / overflow-y).
    expect(getComputedStyle(sheet!).maxHeight).toMatch(/^(none|)$/);
    expect(getComputedStyle(sheet!).overflowY).not.toMatch(/^(auto|scroll)$/);
    expect(getComputedStyle(sheet!).borderRadius).toBe("0px");
    // Sticky-note floor — taller than a pure content hug, still under the scrollport.
    expect(sheetRect.height).toBeGreaterThanOrEqual(20 * 16 - 1);
    expect(sheetRect.height).toBeLessThan(scroll!.clientHeight - 1);
    // Short notes: no idle scroll on the desk scrollport or inside the sheet.
    expect(scroll!.scrollHeight).toBeLessThanOrEqual(scroll!.clientHeight + 1);
    expect(sheet!.scrollHeight).toBeLessThanOrEqual(sheet!.clientHeight + 1);

    await expectNotebookTaskChecks(canvasElement);
  },
};

export const NotebookTintDark: Story = {
  tags: ["vitest-ci"],
  args: { detailTint: "#1e3a5f", withTasks: true },
  parameters: {
    viewport: { value: "desktop", isRotated: false },
  },
  play: async ({ canvasElement }) => {
    const workspace = (canvasElement.querySelector(".notes-story-scope--detail") ??
      canvasElement.querySelector(".notes-workspace")) as HTMLElement | null;
    expect(workspace).toBeTruthy();
    expect(workspace!.style.getPropertyValue("--notes-detail-check-fg").trim()).toBe(
      "var(--color-we-got-soft)",
    );
    const chip = canvasElement.querySelector(
      ".note-detail-view__tag-group .tag",
    ) as HTMLElement | null;
    expect(chip).toBeTruthy();
    expectActiveDetailTag(chip!, workspace!);
    const title = canvasElement.querySelector(".note-detail-view__title") as HTMLElement | null;
    const softInk = document.createElement("span");
    softInk.style.color = "var(--notes-detail-contrast-fg)";
    workspace!.appendChild(softInk);
    expect(title).toBeTruthy();
    expect(getComputedStyle(title!).color).toBe(getComputedStyle(softInk).color);
    softInk.remove();
    await expectNotebookTaskChecks(canvasElement);
  },
};

/** Task checks: the selection mark shape, filled with the notebook colour when checked. */
export const TaskChecks: Story = {
  tags: ["vitest-ci"],
  args: { withTasks: true },
  play: async ({ canvasElement }) => expectNotebookTaskChecks(canvasElement),
};

/** Dark: same notebook fill and contrast check. */
export const TaskChecksDark: Story = {
  ...TaskChecks,
  decorators: [withDarkTheme],
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
    expectActiveDetailTag(chip as HTMLElement, workspace as HTMLElement);
  },
};

export const WithPullQuote: Story = {
  args: { withPullQuote: true },
};

export const TallScroll: Story = {
  args: { tallBody: true },
};
