import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  createMockCalendarReplyMailboxOperations,
  mockCalendarReplyMailbox,
} from "@/lib/api/mock/calendar-reply-mailbox";
import type { CalendarReplyMailboxOperations } from "@/lib/api/wgw/calendar-reply-mailbox";
import { SettingsCalendarReplyMailboxSection } from "@/settings-core/src/settings-calendar-reply-mailbox-section";
import { SettingsStoryScope } from "./settings-story-scope";

const meta = {
  title: "Features/Settings/Panes/Calendar invitation replies",
  component: SettingsCalendarReplyMailboxSection,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof SettingsCalendarReplyMailboxSection>;

export default meta;
type Story = StoryObj<typeof SettingsCalendarReplyMailboxSection>;

function story(operations: CalendarReplyMailboxOperations): Story["render"] {
  return () => (
    <SettingsStoryScope>
      <SettingsCalendarReplyMailboxSection operations={operations} />
    </SettingsStoryScope>
  );
}

/** Nothing connected yet. The password `wrong` shows the failed-login message. */
export const NotConnected: Story = {
  render: story(createMockCalendarReplyMailboxOperations()),
};

export const Connected: Story = {
  render: story(createMockCalendarReplyMailboxOperations(mockCalendarReplyMailbox())),
};

export const WaitingForFirstMessage: Story = {
  render: story(
    createMockCalendarReplyMailboxOperations(mockCalendarReplyMailbox({ trustedServer: null })),
  ),
};

export const PausedAfterFailedSignIns: Story = {
  render: story(
    createMockCalendarReplyMailboxOperations(
      mockCalendarReplyMailbox({ active: false, lastError: "auth_failed" }),
    ),
  ),
};
