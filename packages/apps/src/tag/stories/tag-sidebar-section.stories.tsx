import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { TagSidebarSection } from "../src/tag-sidebar-section";

const meta: Meta<typeof TagSidebarSection> = {
  title: "UI/Primitives/Tag Sidebar Section",
  component: TagSidebarSection,
};

export default meta;
type Story = StoryObj<typeof TagSidebarSection>;

const TAGS = ["client-a", "review", "invoice-2026", "quarterly-planning"];

export const PickATag: Story = {
  render: function PickATagStory() {
    const [selected, setSelected] = useState<string | null>(null);
    return (
      <nav style={{ width: 240 }}>
        <TagSidebarSection
          title="Tags"
          tags={TAGS.map((tag) => ({
            tag,
            selected: selected === tag,
            onSelect: () => setSelected(selected === tag ? null : tag),
          }))}
        />
      </nav>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const review = canvas.getByRole("button", { name: "review" });
    await userEvent.click(review);
    await expect(review).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(review);
    await expect(review).toHaveAttribute("aria-pressed", "false");
  },
};
