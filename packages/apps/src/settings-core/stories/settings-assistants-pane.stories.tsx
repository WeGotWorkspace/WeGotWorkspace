import type { Meta, StoryObj } from "@storybook/react-vite";
import { SettingsAssistantsPane } from "@/settings-core/src/settings-assistants-pane";
import { SettingsStoryScope } from "./settings-story-scope";
import type { SettingsMcpGrant } from "@/settings-core/src/settings-types";

const sampleGrants: SettingsMcpGrant[] = [
  {
    clientId: "11111111-1111-1111-1111-111111111111",
    clientName: "Claude",
    clientOrigin: "https://claude.ai",
    connectedAt: "2026-09-08T10:00:00Z",
    scopes: ["drive", "docs", "mail.read"],
    lastUsedAt: "2026-09-08T11:00:00Z",
  },
];

function AssistantsHarness({ grants }: { grants: SettingsMcpGrant[] }) {
  return (
    <SettingsStoryScope>
      <SettingsAssistantsPane
        assistants={{
          grants,
          loading: false,
          revokingId: null,
          error: null,
          refresh: async () => {},
          revoke: async () => {},
        }}
      />
    </SettingsStoryScope>
  );
}

const meta = {
  title: "Settings/Connected assistants pane",
  component: SettingsAssistantsPane,
  parameters: { layout: "padded" },
} satisfies Meta<typeof SettingsAssistantsPane>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  render: () => <AssistantsHarness grants={[]} />,
};

export const Connected: Story = {
  render: () => <AssistantsHarness grants={sampleGrants} />,
};
