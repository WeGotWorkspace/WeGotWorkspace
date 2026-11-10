import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { Archive, Circle, Star } from "lucide-react";
import { ListItem } from "@/list-item/src/list-item";
import { Checkbox } from "@/ui/checkbox";
import { withDarkTheme } from "@/branding-playground/dark-theme-story";

const meta: Meta<typeof ListItem> = {
  title: "UI/Primitives/List Item",
  component: ListItem,
};

export default meta;
type Story = StoryObj<typeof ListItem>;

export const NoteStyle: Story = {
  args: {
    id: "note-1",
    title: "The Architecture of Quiet",
    subtitle: "The Journal",
    date: "12 Oct 2024",
    text: "The silence of a library is not the absence of sound, but the presence of focus.",
    icons: [
      <Star
        className="size-3 transition-opacity"
        fill="currentColor"
        style={{ color: "var(--color-emerald)", opacity: 1 }}
      />,
    ],
    isActive: true,
    isSelected: false,
    selectionMode: false,
    isTouch: false,
    isDragging: false,
    onClick: () => {},
    onLongPress: () => {},
    onDragStart: () => {},
    onDragEnd: () => {},
  },
};

export const MailStyleTouch: Story = {
  args: {
    ...NoteStyle.args,
    id: "mail-1",
    subtitle: "Elena Harper",
    title: "Quarterly design review",
    text: "Can we align on the revised timeline before Thursday's call?",
    icons: [
      <Circle
        className="size-2.5"
        fill="currentColor"
        strokeWidth={0}
        style={{ color: "var(--color-emerald)" }}
      />,
      <Star
        className="size-3 transition-opacity"
        fill="currentColor"
        style={{ color: "var(--color-emerald)", opacity: 0.7 }}
      />,
    ],
    isTouch: true,
    swipeLeftAction: {
      icon: <Star className="size-5" fill="currentColor" />,
      label: "Star",
      onActivate: () => {},
    },
    swipeRightAction: {
      icon: <Archive className="size-5" />,
      tone: "danger",
      label: "Archive",
      onActivate: () => {},
    },
  },
  render: (args) => (
    <div className="max-w-2xl border rounded-md overflow-hidden">
      <ListItem {...args} />
    </div>
  ),
};

const multiSelectRows = (args: Story["args"]) => (
  <div className="max-w-md" data-list-selection-mode="true">
    <ListItem {...args} id="ms-1" title="Selected note" isSelected selectionMode />
    <ListItem {...args} id="ms-2" title="Not selected" isActive={false} selectionMode />
  </div>
);

/** Probe a colour token the way the browser resolves it on a given element. */
function resolvedBackground(host: Element, value: string) {
  const probe = document.createElement("span");
  probe.style.backgroundColor = value;
  host.appendChild(probe);
  const color = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return color;
}

/** The bar a selected row paints on its leading edge (its `::before`). */
function selectionBar(row: HTMLElement) {
  return getComputedStyle(row, "::before");
}

async function expectSelectionBar(canvasElement: HTMLElement) {
  const [selected, unselected] = Array.from(
    canvasElement.querySelectorAll<HTMLElement>(".list-item__button"),
  );
  // No checkboxes in lists: those are for tasks.
  await expect(canvasElement.querySelector(".selection-mark")).toBeNull();
  // Selected: a thick bar on the leading edge, in the selection mark's fill.
  const bar = selectionBar(selected);
  await expect(bar.width).toBe("4px");
  await expect(bar.left).toBe("6px");
  await expect(bar.backgroundColor).toBe(
    resolvedBackground(selected, "var(--workspace-selected-mark-background)"),
  );
  // Straight: it stops where the corner rounding starts, so it never bends.
  await expect(bar.top).toBe(getComputedStyle(selected).borderTopLeftRadius);
  await expect(bar.bottom).toBe(getComputedStyle(selected).borderBottomLeftRadius);
  // Stronger than the wash it sits on.
  await expect(bar.backgroundColor).not.toBe(getComputedStyle(selected).backgroundColor);
  // Not selected: no bar, and the text does not move over in selection mode.
  await expect(selectionBar(unselected).content).toBe("none");
  await expect(getComputedStyle(unselected).paddingLeft).toBe(
    getComputedStyle(unselected).paddingRight,
  );
}

/** Multi-select: no checkboxes; a selected row gets a thick bar in the selection tint. */
export const MultiSelect: Story = {
  tags: ["vitest-ci"],
  args: { ...NoteStyle.args, isActive: false, icons: [] },
  render: multiSelectRows,
  play: async ({ canvasElement }) => expectSelectionBar(canvasElement),
};

/** Dark: the sky selection, with a brighter, more saturated sky bar. */
export const MultiSelectDark: Story = {
  ...MultiSelect,
  decorators: [withDarkTheme],
  play: async ({ canvasElement }) => {
    await expectSelectionBar(canvasElement);
    const row = canvasElement.querySelector<HTMLElement>(".list-item__button")!;
    const chroma = (color: string) => Number(/oklch\([\d.]+ ([\d.]+)/.exec(color)?.[1] ?? "0");
    await expect(chroma(selectionBar(row).backgroundColor)).toBeGreaterThan(
      chroma(getComputedStyle(row).backgroundColor),
    );
  },
};

/** A plain click selects one item: the wash only, no bar (the bar means multi-select). */
export const SelectedWithoutSelectionMode: Story = {
  tags: ["vitest-ci"],
  args: { ...NoteStyle.args, isActive: false, icons: [] },
  render: (args) => (
    <div className="max-w-md" data-list-selection-mode="false">
      <ListItem {...args} id="plain" title="Plain click" isSelected />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const row = canvasElement.querySelector<HTMLElement>(".list-item__button")!;
    await expect(row).toHaveAttribute("data-selected", "true");
    await expect(selectionBar(row).content).toBe("none");
  },
};

/**
 * The focus ring is keyboard-only. Chrome also matches `:focus-visible` after a
 * Cmd/Shift-click (multi-select); the last real input (`data-modality`) decides.
 * During a multi-selection there is no ring: the bars already show the range.
 */
export const KeyboardOnlyFocusRing: Story = {
  tags: ["vitest-ci"],
  args: { ...NoteStyle.args, isActive: false, icons: [] },
  render: (args) => (
    <div className="max-w-md">
      <div data-list-selection-mode="false">
        <ListItem {...args} id="single" title="Single" />
      </div>
      <div data-list-selection-mode="true">
        <ListItem {...args} id="multi" title="In a multi-selection" isSelected selectionMode />
      </div>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const [single, multi] = Array.from(
      canvasElement.querySelectorAll<HTMLElement>(".list-item__button"),
    );
    const root = document.documentElement;
    const previous = root.dataset.modality;
    const ringOn = (row: HTMLElement) => getComputedStyle(row).boxShadow.includes("inset");
    try {
      root.dataset.modality = "keyboard";
      single.focus({ focusVisible: true } as FocusOptions);
      if (single.matches(":focus-visible")) await expect(ringOn(single)).toBe(true);
      root.dataset.modality = "pointer";
      await expect(ringOn(single)).toBe(false);

      root.dataset.modality = "keyboard";
      multi.focus({ focusVisible: true } as FocusOptions);
      await expect(ringOn(multi)).toBe(false);
    } finally {
      if (previous === undefined) delete root.dataset.modality;
      else root.dataset.modality = previous;
      (document.activeElement as HTMLElement | null)?.blur();
    }
  },
};

/**
 * A control at the row start (Tasks: the complete circle). It sits beside the row
 * button, not inside it, level with the title; the text keeps its own column.
 */
export const WithLeadingControl: Story = {
  tags: ["vitest-ci"],
  args: {
    ...NoteStyle.args,
    isActive: false,
    icons: [],
    date: "",
    metaPosition: "below",
    title: "Call the dentist",
    subtitle: "Inbox",
    text: "Ask about the Thursday slot.",
  },
  render: (args) => (
    <div className="max-w-md">
      <ListItem {...args} leadingControl={<Checkbox size="md" aria-label="Mark complete" />} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const checkbox = canvasElement.querySelector<HTMLElement>('[aria-label="Mark complete"]')!;
    await expect(checkbox.closest("button.list-item__button")).toBeNull();
    const title = canvasElement.querySelector(".list-item__title")!.getBoundingClientRect();
    const box = checkbox.getBoundingClientRect();
    await expect(Math.abs(box.top + box.height / 2 - (title.top + title.height / 2))).toBeLessThan(
      3,
    );
    await expect(box.right).toBeLessThan(title.left);
    const text = canvasElement.querySelector(".list-item__body")!.getBoundingClientRect();
    await expect(Math.abs(text.left - title.left)).toBeLessThan(1);
  },
};
