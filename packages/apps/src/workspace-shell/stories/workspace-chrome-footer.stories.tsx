import type { Meta, StoryObj } from "@storybook/react-vite";
import { BookOpen, CalendarDays } from "lucide-react";
import { Tag } from "@/tag/src/tag";
import { WorkspaceChromeFooter } from "@/workspace-shell/src/workspace-chrome-footer";

const meta = {
  title: "Shared/Workspace Chrome Footer",
  component: WorkspaceChromeFooter,
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof WorkspaceChromeFooter>;

export default meta;
type Story = StoryObj<typeof WorkspaceChromeFooter>;

export const Default: Story = {
  render: () => (
    <WorkspaceChromeFooter>
      <Tag label="Personal" icon={<BookOpen className="size-3.5 opacity-70" />} />
      <Tag label="Edited yesterday" icon={<CalendarDays className="size-3.5 opacity-70" />} />
    </WorkspaceChromeFooter>
  ),
};

export const WithEndStatus: Story = {
  name: "With end status",
  render: () => (
    <WorkspaceChromeFooter end={<span className="text-xs opacity-70">Saved</span>}>
      <Tag label="42 words" />
      <Tag label="210 characters" />
    </WorkspaceChromeFooter>
  ),
};
