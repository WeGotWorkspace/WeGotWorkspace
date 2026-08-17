import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChevronLeft, ChevronRight, PenSquare, Trash2 } from "lucide-react";
import { Button, IconButton } from "@/button/src/button";
import { ViewHeader } from "@/view-header/src/view-header";
import "./view-header.stories.css";

const meta: Meta<typeof ViewHeader> = {
  title: "Shared/View Header",
  component: ViewHeader,
  argTypes: {
    layout: {
      control: "select",
      options: ["inline", "stacked", "responsive"],
    },
  },
};

export default meta;
type Story = StoryObj<typeof ViewHeader>;

export const Default: Story = {
  args: {
    title: "All Items",
    subtitle: "24 Files",
    sidebarOpen: true,
    onToggleSidebar: () => {},
    actions: (
      <div className="view-header-story-actions flex items-center gap-2">
        <IconButton
          label="Compose"
          onClick={() => {}}
          icon={<PenSquare />}
          size="sm"
          variant="subtle"
        />
        <IconButton
          label="Delete"
          onClick={() => {}}
          icon={<Trash2 />}
          size="sm"
          variant="subtle"
        />
      </div>
    ),
    searchPlaceholder: "Search notes...",
    onSearchInput: () => {},
  },
};

export const WithoutSearch: Story = {
  args: {
    ...Default.args,
    searchPlaceholder: undefined,
  },
};

/** Compact title (medium-size, medium-weight, sans-serif) used for the doc editor file name. */
export const SmallTitle: Story = {
  args: {
    ...Default.args,
    title: "quarterly-report.md",
    subtitle: undefined,
    titleSize: "sm",
    searchPlaceholder: undefined,
  },
};

/** Portaled surfaces (e.g. mail compose dialog) omit the sidebar toggle. */
export const WithoutSidebarToggle: Story = {
  args: {
    title: "New message",
    subtitle: "Drafts · Today 14:32",
    hideSidebarToggle: true,
  },
};

const periodNav = (
  <div className="view-header-story-nav">
    <IconButton label="Previous period" icon={<ChevronLeft />} onClick={() => {}} />
    <IconButton label="Next period" icon={<ChevronRight />} onClick={() => {}} />
  </div>
);

const periodActions = (
  <div className="view-header-story-actions flex items-center gap-2">
    <Button label="Month" onClick={() => {}} variant="subtle" />
    <Button label="Today" onClick={() => {}} variant="subtle" />
  </div>
);

/** Title + prev/next on the first row; other actions on the second. */
export const Stacked: Story = {
  args: {
    title: "August 2026",
    sidebarOpen: true,
    onToggleSidebar: () => {},
    layout: "stacked",
    titleLeading: periodNav,
    actions: periodActions,
  },
};

/** Same chrome as Stacked, but only stacks when the header column is narrow. */
export const ResponsiveStacked: Story = {
  args: {
    ...Stacked.args,
    layout: "responsive",
  },
  decorators: [
    (Story) => (
      <div className="view-header-story-narrow">
        <Story />
      </div>
    ),
  ],
};
