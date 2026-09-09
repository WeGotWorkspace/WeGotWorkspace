import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import {
  SETTINGS_GRANTED_PERMISSIONS_HINT,
  SETTINGS_GRANTED_PERMISSIONS_TITLE,
  SettingsAssistantsPane,
} from "@/settings-core/src/settings-assistants-pane";
import { MCP_ASSISTANT_DATA_WARNING_TITLE } from "@/settings-core/src/mcp-assistant-data-warning";
import { STORY_MCP_ENDPOINT_URL } from "@/settings-core/src/mcp-endpoint";
import { shareLabels } from "@/share-ui/share-labels";
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
        mcpEndpointUrl={STORY_MCP_ENDPOINT_URL}
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
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("No assistants connected")).toBeTruthy();
    await expect(canvas.queryByText(MCP_ASSISTANT_DATA_WARNING_TITLE)).toBeNull();
    await expect(canvas.getByRole("textbox", { name: "Connection URL" })).toHaveValue(
      STORY_MCP_ENDPOINT_URL,
    );
    await expect(canvas.getByRole("button", { name: shareLabels.copyLink })).toBeInTheDocument();
  },
};

export const Connected: Story = {
  render: () => <AssistantsHarness grants={sampleGrants} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Claude")).toBeTruthy();
    await expect(canvas.getByText("claude.ai")).toBeTruthy();
    await expect(canvas.queryByText("https://claude.ai")).toBeNull();
    await expect(canvas.getByText("chatgpt.com")).toBeTruthy();
    await expect(canvas.queryByText(/Never used/)).toBeNull();
    await expect(canvas.queryByText(/Connected /)).toBeNull();
    await expect(canvas.queryByText("Last used")).toBeNull();
    const revokeClaude = canvas.getByRole("button", { name: "Revoke Claude" });
    await expect(revokeClaude).toBeTruthy();
    await expect(revokeClaude).toHaveClass("button--variant-destructive-outline");
    await expect(revokeClaude).not.toHaveClass("button--variant-destructive");
    await expect(revokeClaude).not.toHaveClass("button--variant-subtle");
    await expect(canvas.getByRole("button", { name: "Revoke ChatGPT" })).toBeTruthy();
    await expect(canvas.getAllByText(SETTINGS_GRANTED_PERMISSIONS_TITLE).length).toBeGreaterThan(0);
    await expect(canvas.getAllByText(SETTINGS_GRANTED_PERMISSIONS_HINT).length).toBeGreaterThan(0);
    await expect(canvas.queryByText("Permissions")).toBeNull();
    await expect(canvas.queryByText("Choose what this assistant may do.")).toBeNull();
    await expect(canvas.queryByText(MCP_ASSISTANT_DATA_WARNING_TITLE)).toBeNull();
    await expect(canvas.getByRole("textbox", { name: "Connection URL" })).toHaveValue(
      STORY_MCP_ENDPOINT_URL,
    );
    await expect(canvas.getByRole("button", { name: shareLabels.copyLink })).toBeInTheDocument();
  },
};

export const Loading: Story = {
  render: () => <AssistantsHarness grants={[]} loading />,
};

export const LoadError: Story = {
  render: () => <AssistantsHarness grants={[]} error="Could not load connected assistants." />,
};
