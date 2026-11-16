import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  createMockCalendarReplyMailboxOperations,
  mockCalendarReplyMailbox,
} from "@/lib/api/mock/calendar-reply-mailbox";
import { SettingsIncomingEmailPane } from "@/settings-core/src/settings-incoming-email-pane";
import type { IncomingMailboxOperations } from "@/settings-core/src/settings-incoming-email-source";
import { SettingsStoryScope } from "./settings-story-scope";

const meta = {
  title: "Features/Settings/Panes/Incoming email",
  component: SettingsIncomingEmailPane,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof SettingsIncomingEmailPane>;

export default meta;
type Story = StoryObj<typeof SettingsIncomingEmailPane>;

function story(operations: IncomingMailboxOperations): Story["render"] {
  return () => (
    <SettingsStoryScope>
      <SettingsIncomingEmailPane operations={operations} />
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
