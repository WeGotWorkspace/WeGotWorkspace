import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, waitFor } from "storybook/test";
import { NoteDetailView } from "@/note-detail-view/src/note-detail-view";
import { NotesDetailLastEdited } from "@/notes-core/src/notes-detail-last-edited";
import { getNotesDetailStoryProps } from "./notes-pane-stories.fixtures";
import { NotesStoryScope } from "./notes-story-scope";
import "@/workspace-app/src/workspace-app.css";

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
 * Detail tags are the Tag primitive's neutral chip (tags run across notebooks):
 * not the notebook colour, a faint ink wash with no edge, and the label follows
 * the chip ink.
 */
function expectNeutralDetailTag(chip: HTMLElement, host: HTMLElement) {
  const notebookWash = document.createElement("span");
  notebookWash.style.backgroundColor = "var(--note-detail-tag-bg)";
  host.appendChild(notebookWash);
  const style = getComputedStyle(chip);
  expect(style.backgroundColor).not.toBe(getComputedStyle(notebookWash).backgroundColor);
  notebookWash.remove();
  const alpha = Number(/\/ ([\d.]+)\)$/.exec(style.backgroundColor)?.[1] ?? "1");
  expect(alpha).toBeLessThan(0.12);
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

/** Tags are touch-safe chips (30px with a mouse, 44px on touch) right under the title. */
export const TouchSafeTags: Story = {
  tags: ["vitest-ci"],
  args: {},
  play: async ({ canvasElement }) => {
    const title = canvasElement.querySelector(".note-detail-view__title") as HTMLElement;
    const group = canvasElement.querySelector(".note-detail-view__tag-group") as HTMLElement;
    const chip = group.querySelector(".tag") as HTMLElement;
    const remove = chip.querySelector(".tag__remove") as HTMLElement;
    const minHeight = matchMedia("(pointer: coarse)").matches ? 44 : 30;

    const chipBox = chip.getBoundingClientRect();
    await expect(chipBox.height).toBeGreaterThanOrEqual(minHeight);
    // The remove target spans the chip's full height and reaches its end edge.
    const removeBox = remove.getBoundingClientRect();
    await expect(removeBox.height).toBe(chipBox.height);
    await expect(removeBox.width).toBeGreaterThanOrEqual(minHeight);
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
    expectNeutralDetailTag(chip!, workspace!);
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

    const editor = canvasElement.querySelector(".note-text-editor-body") as HTMLElement | null;
    expect(editor).toBeTruthy();
    const checkboxFill = document.createElement("span");
    const checkboxMark = document.createElement("span");
    const checkboxBorder = document.createElement("span");
    const tagBg = document.createElement("span");
    const tagFg = document.createElement("span");
    const tagBorder = document.createElement("span");
    const accentProbe = document.createElement("span");
    checkboxFill.style.color = "var(--checkbox-checked-bg)";
    checkboxMark.style.color = "var(--checkbox-checked-fg)";
    checkboxBorder.style.color = "var(--checkbox-checked-border)";
    tagBg.style.color = "var(--note-detail-tag-bg)";
    tagFg.style.color = "var(--note-detail-tag-fg)";
    tagBorder.style.color = "var(--note-detail-tag-border)";
    accentProbe.style.color = "var(--notes-detail-accent)";
    editor!.appendChild(checkboxFill);
    editor!.appendChild(checkboxMark);
    editor!.appendChild(checkboxBorder);
    editor!.appendChild(tagBg);
    editor!.appendChild(tagFg);
    editor!.appendChild(tagBorder);
    workspace!.appendChild(accentProbe);
    expect(getComputedStyle(checkboxFill).color).toBe(getComputedStyle(tagBg).color);
    expect(getComputedStyle(checkboxFill).color).not.toBe(getComputedStyle(accentProbe).color);
    expect(getComputedStyle(checkboxMark).color).toBe(getComputedStyle(tagFg).color);
    expect(getComputedStyle(checkboxBorder).color).toBe(getComputedStyle(tagBorder).color);
    checkboxFill.remove();
    checkboxMark.remove();
    checkboxBorder.remove();
    tagBg.remove();
    tagFg.remove();
    tagBorder.remove();
    accentProbe.remove();
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
    expectNeutralDetailTag(chip!, workspace!);
    const accentStrong = document.createElement("span");
    accentStrong.style.color = "var(--notes-detail-accent-strong)";
    workspace!.appendChild(accentStrong);
    const title = canvasElement.querySelector(".note-detail-view__title") as HTMLElement | null;
    const softInk = document.createElement("span");
    softInk.style.color = "var(--notes-detail-contrast-fg)";
    workspace!.appendChild(softInk);
    expect(title).toBeTruthy();
    expect(getComputedStyle(title!).color).toBe(getComputedStyle(softInk).color);
    softInk.remove();
    const editor = canvasElement.querySelector(".note-text-editor-body") as HTMLElement | null;
    expect(editor).toBeTruthy();
    const fill = document.createElement("span");
    const mark = document.createElement("span");
    const tagBg = document.createElement("span");
    const accent = document.createElement("span");
    const cream = document.createElement("span");
    fill.style.color = "var(--checkbox-checked-bg)";
    mark.style.color = "var(--checkbox-checked-fg)";
    tagBg.style.color = "var(--note-detail-tag-bg)";
    accent.style.color = "var(--notes-detail-accent)";
    cream.style.color = "var(--color-we-got-soft)";
    editor!.appendChild(fill);
    editor!.appendChild(mark);
    editor!.appendChild(tagBg);
    workspace!.appendChild(accent);
    workspace!.appendChild(cream);
    expect(getComputedStyle(fill).color).toBe(getComputedStyle(tagBg).color);
    expect(getComputedStyle(fill).color).not.toBe(getComputedStyle(accent).color);
    expect(getComputedStyle(mark).color).toBe(getComputedStyle(accentStrong).color);
    expect(getComputedStyle(mark).color).not.toBe(getComputedStyle(cream).color);
    fill.remove();
    mark.remove();
    tagBg.remove();
    accent.remove();
    cream.remove();
    accentStrong.remove();
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
    expectNeutralDetailTag(chip as HTMLElement, workspace as HTMLElement);
  },
};

export const WithPullQuote: Story = {
  args: { withPullQuote: true },
};

export const TallScroll: Story = {
  args: { tallBody: true },
};
