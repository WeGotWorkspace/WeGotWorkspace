import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, waitFor } from "storybook/test";
import { NoteDetailView } from "@/note-detail-view/src/note-detail-view";
import { NotesDetailFooter } from "@/notes-core/src/notes-detail-footer";
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
    const sheet = canvasElement.querySelector(".note-detail-sheet");
    expect(sheet).toBeTruthy();
    expect(sheet!.querySelector(".note-detail-view__title")).toBeTruthy();
    expect(sheet!.querySelector(".note-detail-view__tag-group")).toBeTruthy();
    expect(sheet!.querySelector(".note-text-editor-body")).toBeTruthy();
    expect(sheet!.querySelector(".notes-detail-footer")).toBeNull();
    expect(canvasElement.querySelector(".notes-detail-footer")).toBeTruthy();

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
    const probe = document.createElement("span");
    probe.style.color = "var(--note-detail-tag-fg)";
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

    expect(
      getComputedStyle(workspace as HTMLElement)
        .getPropertyValue("--notes-detail-tint")
        .trim(),
    ).toBe("");
    const accentProbe = document.createElement("span");
    accentProbe.style.color = "var(--notes-accent)";
    workspace!.appendChild(accentProbe);
    expect(getComputedStyle(accentProbe).color).not.toBe("rgb(246, 209, 118)");
    accentProbe.remove();
  },
};

export const NotebookTint: Story = {
  tags: ["vitest-ci"],
  args: { detailTint: "#ec4899", withTasks: true },
  play: async ({ canvasElement }) => {
    const workspace = canvasElement.querySelector(".notes-workspace") as HTMLElement | null;
    expect(workspace).toBeTruthy();
    expect(getComputedStyle(workspace!).getPropertyValue("--notes-detail-tint").trim()).toBe(
      "#ec4899",
    );
    const sheet = canvasElement.querySelector(".note-detail-sheet") as HTMLElement | null;
    const scroll = canvasElement.querySelector(
      ".workspace-detail-pane__scroll",
    ) as HTMLElement | null;
    expect(sheet).toBeTruthy();
    expect(scroll).toBeTruthy();
    expect(getComputedStyle(sheet!).backgroundColor).not.toBe(
      getComputedStyle(scroll!).backgroundColor,
    );
    const chip = canvasElement.querySelector(
      ".note-detail-view__tag-group .tag",
    ) as HTMLElement | null;
    expect(chip).toBeTruthy();
    const tintBg = document.createElement("span");
    const sheetBg = document.createElement("span");
    const paneBg = document.createElement("span");
    const detailFg = document.createElement("span");
    const sidebarFg = document.createElement("span");
    tintBg.style.backgroundColor = "var(--notes-detail-tint)";
    sheetBg.style.backgroundColor = "var(--note-detail-sheet-bg)";
    paneBg.style.backgroundColor = "var(--workspace-detail-bg)";
    detailFg.style.color = "var(--note-detail-tag-fg)";
    sidebarFg.style.color = "var(--notes-tag-selected-fg)";
    workspace!.appendChild(tintBg);
    workspace!.appendChild(sheetBg);
    workspace!.appendChild(paneBg);
    workspace!.appendChild(detailFg);
    workspace!.appendChild(sidebarFg);
    expect(getComputedStyle(sheet!).backgroundColor).toBe(getComputedStyle(sheetBg).backgroundColor);
    expect(getComputedStyle(sheet!).backgroundColor).not.toBe(
      getComputedStyle(tintBg).backgroundColor,
    );
    expect(getComputedStyle(scroll!).backgroundColor).toBe(getComputedStyle(paneBg).backgroundColor);
    expect(getComputedStyle(scroll!).backgroundColor).not.toBe(
      getComputedStyle(tintBg).backgroundColor,
    );
    const cream = document.createElement("span");
    cream.style.backgroundColor = "var(--workspace-chrome-footer-bg, var(--color-cream, #ffffff))";
    workspace!.appendChild(cream);
    expect(getComputedStyle(scroll!).backgroundColor).toBe(getComputedStyle(cream).backgroundColor);
    expect(getComputedStyle(sheet!).backgroundColor).not.toBe(
      getComputedStyle(cream).backgroundColor,
    );
    cream.remove();
    expect(getComputedStyle(chip!).backgroundColor).not.toBe(
      getComputedStyle(tintBg).backgroundColor,
    );
    expect(getComputedStyle(chip!).color).toBe(getComputedStyle(detailFg).color);
    expect(getComputedStyle(chip!).color).not.toBe(getComputedStyle(sidebarFg).color);
    const sheetRect = sheet!.getBoundingClientRect();
    const scrollStyle = getComputedStyle(scroll!);
    const padY =
      Number.parseFloat(scrollStyle.paddingTop) + Number.parseFloat(scrollStyle.paddingBottom);
    expect(getComputedStyle(sheet!).minHeight).toBe("100%");
    expect(getComputedStyle(sheet!).borderRadius).toBe("0px");
    expect(sheetRect.height).toBeGreaterThanOrEqual(scroll!.clientHeight - padY - 1);
    tintBg.remove();
    sheetBg.remove();
    paneBg.remove();
    detailFg.remove();
    sidebarFg.remove();

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
  play: async ({ canvasElement }) => {
    const workspace = canvasElement.querySelector(".notes-workspace") as HTMLElement | null;
    expect(workspace).toBeTruthy();
    expect(getComputedStyle(workspace!).getPropertyValue("--notes-detail-check-fg").trim()).toBe(
      "var(--color-cream)",
    );
    const chip = canvasElement.querySelector(
      ".note-detail-view__tag-group .tag",
    ) as HTMLElement | null;
    expect(chip).toBeTruthy();
    const ink = document.createElement("span");
    const accentStrong = document.createElement("span");
    ink.style.color = "var(--color-ink)";
    accentStrong.style.color = "var(--notes-detail-accent-strong)";
    workspace!.appendChild(ink);
    workspace!.appendChild(accentStrong);
    expect(getComputedStyle(chip!).color).toBe(getComputedStyle(accentStrong).color);
    const title = canvasElement.querySelector(".note-detail-view__title") as HTMLElement | null;
    const softInk = document.createElement("span");
    softInk.style.color = "var(--notes-detail-contrast-fg)";
    workspace!.appendChild(softInk);
    expect(title).toBeTruthy();
    expect(getComputedStyle(title!).color).toBe(getComputedStyle(softInk).color);
    expect(getComputedStyle(title!).color).not.toBe(getComputedStyle(ink).color);
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
    cream.style.color = "var(--color-cream)";
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
    ink.remove();
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
    const probe = document.createElement("span");
    probe.style.backgroundColor = "var(--note-detail-tag-bg)";
    probe.style.color = "var(--note-detail-tag-fg)";
    probe.style.borderColor = "var(--note-detail-tag-border)";
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
