import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { DocsOutlineSidebar } from "@/docs-core/src/docs-outline-sidebar";
import type { DocsOutlineItem } from "@/docs-core/src/docs-outline";
import { docsLabels } from "@/docs-core/src/docs-labels";
import "@/docs-core/src/docs-workspace.css";

const OUTLINE: DocsOutlineItem[] = [
  { level: 1, text: "Quarterly plan" },
  { level: 2, text: "Goals" },
  { level: 2, text: "Risks" },
  { level: 1, text: "Appendix" },
];

function DocsOutlineSidebarHarness({
  showBackToHome = true,
  items = OUTLINE,
}: {
  showBackToHome?: boolean;
  items?: DocsOutlineItem[];
}) {
  const [active, setActive] = useState<number | null>(0);
  return (
    <div className="docs-workspace w-64 p-3">
      <DocsOutlineSidebar
        labels={docsLabels}
        items={items}
        activeIndex={active}
        onSelect={setActive}
        showBackToHome={showBackToHome}
      />
    </div>
  );
}

const meta = {
  title: "Features/Docs/Panes/Outline sidebar",
  component: DocsOutlineSidebarHarness,
  tags: ["autodocs"],
  parameters: { routerPath: "/docs" },
} satisfies Meta<typeof DocsOutlineSidebarHarness>;

export default meta;
type Story = StoryObj<typeof DocsOutlineSidebarHarness>;

/**
 * The way back to the documents, then the outline. No Settings row: Docs settings sit on
 * the documents list.
 */
export const Default: Story = {
  tags: ["vitest-ci"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const back = canvas.getByRole("button", { name: docsLabels.sidebarBackToHome });
    await expect(back).toHaveClass(/docs-outline-sidebar__back/);
    await expect(canvas.queryByRole("button", { name: "Settings" })).toBeNull();
    await expect(canvas.getByText(docsLabels.sidebarOutline)).toBeInTheDocument();
    const goals = canvas.getByRole("button", { name: "Goals" });
    await userEvent.click(goals);
    await expect(goals).toHaveClass(/menu-item--selected/);
  },
};

/** A shared guest has no way back: just the outline. */
export const GuestWithoutBack: Story = {
  tags: ["vitest-ci"],
  args: { showBackToHome: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole("button", { name: docsLabels.sidebarBackToHome })).toBeNull();
    await expect(canvas.queryByRole("button", { name: "Settings" })).toBeNull();
    await expect(canvas.getByText(docsLabels.sidebarOutline)).toBeInTheDocument();
  },
};
