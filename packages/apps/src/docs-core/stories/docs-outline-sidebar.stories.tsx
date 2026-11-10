import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { DocsOutlineSidebar } from "@/docs-core/src/docs-outline-sidebar";
import type { DocsOutlineItem } from "@/docs-core/src/docs-outline";
import { docsLabels } from "@/docs-core/src/docs-labels";
import { registerBuiltinSettings } from "@/settings-core/src/register-builtin-settings";
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
  registerBuiltinSettings();
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
 * The editor sidebar has no primary button, so Settings is a row: the first
 * section holds the way back to the documents, then Settings, above the outline.
 */
export const Default: Story = {
  tags: ["vitest-ci"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const back = canvas.getByRole("button", { name: docsLabels.sidebarBackToHome });
    const settings = canvas.getByRole("button", { name: "Settings" });
    // Same section, Settings after the way back.
    await expect(back.closest(".sidebar-section")).toBe(settings.closest(".sidebar-section"));
    // Only the way back is a filled chip; Settings is a plain row.
    await expect(back).toHaveClass(/docs-outline-sidebar__back/);
    await expect(settings).not.toHaveClass(/docs-outline-sidebar__back/);
    await expect(getComputedStyle(settings).backgroundColor).not.toBe(
      getComputedStyle(back).backgroundColor,
    );
    await expect(
      back.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await expect(canvas.getByText(docsLabels.sidebarOutline)).toBeInTheDocument();
    const goals = canvas.getByRole("button", { name: "Goals" });
    await userEvent.click(goals);
    await expect(goals).toHaveClass(/menu-item--selected/);
  },
};

/** A shared guest has no way back: Settings is the section's only row. */
export const GuestWithoutBack: Story = {
  tags: ["vitest-ci"],
  args: { showBackToHome: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole("button", { name: docsLabels.sidebarBackToHome })).toBeNull();
    await expect(canvas.getByRole("button", { name: "Settings" })).toBeInTheDocument();
  },
};
