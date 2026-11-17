import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  createMockCalendarReplyMailboxOperations,
  mockCalendarReplyMailbox,
} from "@/lib/api/mock/calendar-reply-mailbox";
import { SettingsCalendarReplyFolderSection } from "@/settings-core/src/settings-calendar-reply-folder-section";
import type { IncomingMailboxOperations } from "@/settings-core/src/settings-incoming-email-source";
import { SettingsStoryScope } from "./settings-story-scope";

const meta = {
  title: "Features/Settings/Panes/Calendar invitation replies",
  component: SettingsCalendarReplyFolderSection,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof SettingsCalendarReplyFolderSection>;

export default meta;
type Story = StoryObj<typeof SettingsCalendarReplyFolderSection>;

function story(operations: IncomingMailboxOperations): Story["render"] {
  return () => (
    <SettingsStoryScope>
      <SettingsCalendarReplyFolderSection operations={operations} />
    </SettingsStoryScope>
  );
}

/** No mailbox yet: the card links to Settings → Incoming email. */
export const NoMailbox: Story = {
  render: story(createMockCalendarReplyMailboxOperations()),
};

/** The folder saves itself. */
export const Connected: Story = {
  render: story(
    createMockCalendarReplyMailboxOperations(mockCalendarReplyMailbox({ folder: "Calendar" })),
  ),
};
