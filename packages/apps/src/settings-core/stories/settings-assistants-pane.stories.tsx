import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import {
  SETTINGS_AUTHORIZED_ASSISTANTS_TITLE,
  SettingsAssistantsPane,
} from "@/settings-core/src/settings-assistants-pane";
import { MCP_ASSISTANT_DATA_WARNING_TITLE } from "@/settings-core/src/mcp-assistant-data-warning";
import { STORY_MCP_ENDPOINT_URL } from "@/lib/mcp-endpoint";
import { shareLabels } from "@/share-ui/share-labels";
import { createSettingsAppBootstrap } from "@/lib/api/mock/settings-bootstrap";
import { SettingsWorkspace } from "@/settings-core/src/settings-workspace";
import { SettingsStoryScope } from "./settings-story-scope";
import type { SettingsMcpGrant } from "@/lib/models/settings-types";

/** Fixed "now" so the relative times in the stories do not drift. */
const STORY_NOW = new Date("2026-11-18T12:00:00+01:00");

const SAFARI_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15";
const CHROME_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0";
const EDGE_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0";

const claudeCode = (overrides: Partial<SettingsMcpGrant>): SettingsMcpGrant => ({
  clientId: "cc",
  clientName: "Claude Code",
  clientOrigin: "http://localhost:33418",
  clientRegistration: "dcr",
  connectedAt: "2026-11-17T09:00:00Z",
  approvedAt: "2026-11-17T09:00:00Z",
  approvedUserAgent: CHROME_MAC,
  scopes: ["calendar.read", "calendar.write", "tasks.read", "tasks.write", "notes.read"],
  lastUsedAt: "2026-11-17T16:00:00Z",
  shareCalls: [],
  ...overrides,
});

/** Claude.ai (CIMD), Claude Code on three machines (DCR duplicates) and ChatGPT. */
const sampleGrants: SettingsMcpGrant[] = [
  {
    clientId: "11111111-1111-1111-1111-111111111111",
    clientName: "Claude",
    clientOrigin: "https://claude.ai",
    clientRegistration: "cimd",
    connectedAt: "2026-11-12T10:00:00Z",
    approvedAt: "2026-11-12T10:00:00Z",
    approvedUserAgent: SAFARI_MAC,
    scopes: [
      "calendar.read",
      "calendar.write",
      "notes.read",
      "notes.write",
      "tasks.read",
      "tasks.write",
      "docs.read",
      "drive.read",
      "offline_access",
    ],
    lastUsedAt: "2026-11-18T10:48:00Z",
    shareCalls: [],
  },
  claudeCode({ clientId: "cc-1" }),
  claudeCode({
    clientId: "cc-2",
    clientOrigin: "http://127.0.0.1:41011",
    approvedAt: "2026-11-03T14:00:00Z",
    connectedAt: "2026-11-03T14:00:00Z",
    approvedUserAgent: FIREFOX_LINUX,
    lastUsedAt: "2026-11-09T08:30:00Z",
  }),
  claudeCode({
    clientId: "cc-3",
    clientOrigin: "http://localhost:50112",
    approvedAt: null,
    approvedUserAgent: null,
    connectedAt: "2026-10-21T11:00:00Z",
    lastUsedAt: null,
  }),
  {
    clientId: "22222222-2222-2222-2222-222222222222",
    clientName: "ChatGPT",
    clientOrigin: "https://chatgpt.com",
    clientRegistration: "cimd",
    connectedAt: "2026-11-01T09:00:00Z",
    approvedAt: "2026-11-01T09:00:00Z",
    approvedUserAgent: EDGE_WINDOWS,
    scopes: ["docs.read", "drive.read"],
    lastUsedAt: "2026-11-15T13:00:00Z",
    shareCalls: [],
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
          revokeAll: async () => {},
        }}
        mcpEndpointUrl={STORY_MCP_ENDPOINT_URL}
        now={STORY_NOW}
      />
    </SettingsStoryScope>
  );
}

const meta = {
  title: "Features/Settings/AI assistants pane",
  component: SettingsAssistantsPane,
  parameters: { layout: "padded" },
} satisfies Meta<typeof SettingsAssistantsPane>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  render: () => <AssistantsHarness grants={[]} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/No assistants yet/)).toBeTruthy();
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
    await expect(canvas.getByText(`${SETTINGS_AUTHORIZED_ASSISTANTS_TITLE} (3)`)).toBeTruthy();
    await expect(canvas.getByText("Claude")).toBeTruthy();
    await expect(canvas.getByText("claude.ai")).toBeTruthy();
    await expect(canvas.getAllByText("Claude Code")).toHaveLength(1);
    await expect(canvas.getByText("Local app")).toBeTruthy();
    await expect(
      canvas.getByRole("button", { name: "Revoke all Claude Code connections" }),
    ).toBeTruthy();
    await expect(canvas.getByText("3 connections")).toBeTruthy();
    await expect(canvas.getByText("Firefox on Linux")).toBeTruthy();
    await expect(canvas.getByText("Unknown browser")).toBeTruthy();
    await expect(canvas.getByText(/^Connected .* · Not used yet$/)).toBeTruthy();
    await expect(canvas.queryByRole("button", { name: "Connect assistant" })).toBeNull();
    await expect(canvas.getByRole("button", { name: "Revoke ChatGPT" })).toBeTruthy();
    await expect(canvas.queryByText(MCP_ASSISTANT_DATA_WARNING_TITLE)).toBeNull();
  },
};

export const Loading: Story = {
  render: () => <AssistantsHarness grants={[]} loading />,
};

export const LoadError: Story = {
  render: () => <AssistantsHarness grants={[]} error="Could not load AI assistants." />,
};

export const DisabledByAdmin: Story = {
  parameters: { layout: "fullscreen" },
  render: () => {
    const bootstrap = createSettingsAppBootstrap({
      data: { ...createSettingsAppBootstrap().data, mcpEnabled: false },
    });
    return <SettingsWorkspace {...bootstrap} initialSection="assistants" />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole("button", { name: "AI assistants" })).toBeNull();
    await expect(canvas.queryByRole("textbox", { name: "Connection URL" })).toBeNull();
    await expect(canvas.queryByText(/No assistants yet/)).toBeNull();
    await expect(canvas.getByRole("button", { name: "Profile" })).toBeTruthy();
  },
};
