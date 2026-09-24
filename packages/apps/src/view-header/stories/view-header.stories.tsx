import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChevronLeft, ChevronRight, Inbox, PenSquare, Trash2 } from "lucide-react";
import { Button, IconButton } from "@/button/src/button";
import { NotificationsInboxValueProvider } from "@/notifications-core/src/notifications-inbox-context";
import { ViewHeader } from "@/view-header/src/view-header";
import "./view-header.stories.css";

const meta: Meta<typeof ViewHeader> = {
  title: "UI/Patterns/View Header",
  component: ViewHeader,
  decorators: [
    (Story) => (
      <div className="view-header-story-surface">
        <Story />
      </div>
    ),
  ],
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
    titleSuffix: (
      <span className="view-header__title-count" aria-label="24 Items">
        (24)
      </span>
    ),
    sidebarOpen: true,
    onToggleSidebar: () => {},
    actions: (
      <div className="view-header-story-actions flex items-center gap-2">
        <IconButton
          label="Compose"
          onClick={() => {}}
          icon={<PenSquare />}
          size="md"
          variant="outline"
        />
        <IconButton
          label="Delete"
          onClick={() => {}}
          icon={<Trash2 />}
          size="md"
          variant="outline"
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

/** File-name style title (same canonical sans as Default). */
export const SmallTitle: Story = {
  args: {
    ...Default.args,
    title: "quarterly-report.md",
    titleSuffix: undefined,
    searchPlaceholder: undefined,
  },
};

/** Portaled surfaces (e.g. mail compose dialog) omit the sidebar toggle. */
export const WithoutSidebarToggle: Story = {
  args: {
    title: "New message",
    hideSidebarToggle: true,
  },
};

/** Closed rail/hamburger shows an unread presence dot; numeric count stays on the bell. */
export const ClosedSidebarUnread: Story = {
  decorators: [
    (Story) => (
      <NotificationsInboxValueProvider
        value={{
          items: [],
          unreadCount: 3,
          onOpenItem: () => undefined,
          onMarkAllRead: () => undefined,
          markReadWhere: async () => undefined,
          onEnablePush: () => undefined,
          pushEnabled: true,
          soundMuted: false,
          onToggleSoundMute: () => undefined,
          unreadArrivalNonce: 0,
        }}
      >
        <Story />
      </NotificationsInboxValueProvider>
    ),
  ],
  args: {
    ...Default.args,
    sidebarOpen: false,
  },
};

const periodNav = (
  <div className="view-header-story-nav">
    <IconButton
      label="Previous period"
      icon={<ChevronLeft />}
      onClick={() => {}}
      size="md"
      variant="outline"
    />
    <IconButton
      label="Next period"
      icon={<ChevronRight />}
      onClick={() => {}}
      size="md"
      variant="outline"
    />
  </div>
);

const periodActions = (
  <div className="view-header-story-actions flex items-center gap-2">
    <Button label="Month" onClick={() => {}} variant="outline" />
    <Button label="Today" onClick={() => {}} variant="outline" />
  </div>
);

/** View actions on row 1 start; inbox on row 1 end; title + prev/next on row 2. */
export const Stacked: Story = {
  args: {
    title: "August 2026",
    sidebarOpen: true,
    onToggleSidebar: () => {},
    layout: "stacked",
    titleLeading: periodNav,
    titleTrailing: (
      <IconButton label="Inbox" icon={<Inbox />} onClick={() => {}} size="md" variant="outline" />
    ),
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
