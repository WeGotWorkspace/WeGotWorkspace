import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { Archive, Circle, Star } from "lucide-react";
import { ListItem } from "@/list-item/src/list-item";
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
      // White label needs a deep enough fill for AA.
      color: "color-mix(in oklab, var(--color-emerald) 45%, var(--color-we-got-dark))",
      label: "Star",
      onActivate: () => {},
    },
    swipeRightAction: {
      icon: <Archive className="size-5" />,
      color: "var(--color-we-got-dark)",
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

async function expectTintedRoundMarks(canvasElement: HTMLElement) {
  const [checked, unchecked] = Array.from(
    canvasElement.querySelectorAll<HTMLElement>(".list-item__checkbox"),
  );
  // Round marks.
  const box = checked.getBoundingClientRect();
  await expect(
    Number.parseFloat(getComputedStyle(checked).borderTopLeftRadius),
  ).toBeGreaterThanOrEqual(box.width / 2);
  // Checked: the selection wash's tint, stronger; never the old solid ink.
  const row = checked.closest(".list-item__button") as HTMLElement;
  await expect(getComputedStyle(checked).backgroundColor).toBe(
    resolvedBackground(row, "var(--workspace-selected-mark-background)"),
  );
  await expect(getComputedStyle(checked).backgroundColor).not.toBe(
    getComputedStyle(row).backgroundColor,
  );
  await expect(checked.querySelector(".list-item__checkbox-icon")).toBeTruthy();
  // Unchecked: an empty ring.
  await expect(getComputedStyle(unchecked).backgroundColor).toBe("rgba(0, 0, 0, 0)");
}

/** Multi-select: round marks; a checked mark is the row's selection tint, stronger. */
export const MultiSelect: Story = {
  tags: ["vitest-ci"],
  args: { ...NoteStyle.args, isActive: false, icons: [] },
  render: multiSelectRows,
  play: async ({ canvasElement }) => expectTintedRoundMarks(canvasElement),
};

/** Dark: the sky selection, with a brighter, more saturated sky mark. */
export const MultiSelectDark: Story = {
  ...MultiSelect,
  decorators: [withDarkTheme],
  play: async ({ canvasElement }) => {
    await expectTintedRoundMarks(canvasElement);
    const checked = canvasElement.querySelector<HTMLElement>(".list-item__checkbox")!;
    const row = checked.closest(".list-item__button") as HTMLElement;
    const chroma = (color: string) => Number(/oklch\([\d.]+ ([\d.]+)/.exec(color)?.[1] ?? "0");
    await expect(chroma(getComputedStyle(checked).backgroundColor)).toBeGreaterThan(
      chroma(getComputedStyle(row).backgroundColor),
    );
  },
};

/**
 * The focus ring is keyboard-only. Chrome also matches `:focus-visible` after a
 * Cmd/Shift-click (multi-select); the last real input (`data-modality`) decides.
 */
export const KeyboardOnlyFocusRing: Story = {
  ...MultiSelect,
  play: async ({ canvasElement }) => {
    const row = canvasElement.querySelector<HTMLElement>(".list-item__button")!;
    const root = document.documentElement;
    const previous = root.dataset.modality;
    try {
      root.dataset.modality = "keyboard";
      row.focus({ focusVisible: true } as FocusOptions);
      if (row.matches(":focus-visible")) {
        await expect(getComputedStyle(row).boxShadow).toContain("inset");
      }
      root.dataset.modality = "pointer";
      await expect(getComputedStyle(row).boxShadow).toBe("none");
    } finally {
      if (previous === undefined) delete root.dataset.modality;
      else root.dataset.modality = previous;
      row.blur();
    }
  },
};
