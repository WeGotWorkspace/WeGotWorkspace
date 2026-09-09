import type { Meta, StoryObj } from "@storybook/react-vite";
import { SettingsAssistantsPane } from "@/settings-core/src/settings-assistants-pane";
import { SettingsStoryScope } from "./settings-story-scope";
import type { SettingsMcpGrant } from "@/settings-core/src/settings-types";

/** Realistic post-split grant: per-app `*.read` / `*.write` (not legacy bare ids). */
const sampleGrants: SettingsMcpGrant[] = [
  {
    clientId: "11111111-1111-1111-1111-111111111111",
    clientName: "Claude",
    clientOrigin: "https://claude.ai",
    connectedAt: "2026-09-08T10:00:00Z",
    scopes: [
      "calendar.read",
      "calendar.write",
      "drive.read",
      "drive.write",
      "docs.read",
      "mail.read",
      "settings",
      "offline_access",
    ],
    lastUsedAt: "2026-09-08T11:00:00Z",
  },
  {
    clientId: "22222222-2222-2222-2222-222222222222",
    clientName: "ChatGPT",
    clientOrigin: "https://chatgpt.com",
    connectedAt: "2026-09-07T09:00:00Z",
    scopes: ["notes.read", "tasks.read", "tasks.write", "meet.read"],
    lastUsedAt: null,
  },
];

function AssistantsHarness({
  grants,
  loading = false,
  error = null,
}: {
  grants: SettingsMcpGrant[];
  loading?: boolean;
  error?: string | null;
}) {
  return (
    <SettingsStoryScope>
      <SettingsAssistantsPane
        assistants={{
          grants,
          loading,
          revokingId: null,
          error,
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

export const Loading: Story = {
  render: () => <AssistantsHarness grants={[]} loading />,
};

export const LoadError: Story = {
  render: () => <AssistantsHarness grants={[]} error="Could not load connected assistants." />,
};
