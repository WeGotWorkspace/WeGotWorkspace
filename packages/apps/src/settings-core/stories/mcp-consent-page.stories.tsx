import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import {
  MCP_ASSISTANT_DATA_WARNING_CONSENT_MESSAGE,
  MCP_ASSISTANT_DATA_WARNING_TITLE,
} from "@/settings-core/src/mcp-assistant-data-warning";
import "@/settings-core/src/settings-workspace.css";
import { McpConsentPageMock } from "./mcp-consent-page-mock";
import {
  MCP_CONSENT_DEFAULT_GROUPS,
  mcpConsentGroupsFor,
} from "./mcp-consent-page.stories.fixtures";

const meta = {
  title: "Settings/Connect assistant consent",
  component: McpConsentPageMock,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Mock of the Passport OAuth consent page (grouped Read/Write toggles). Live UI is Blade at `/oauth/authorize` — this story is catalog-only and is not the PWA shell.",
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="settings-workspace settings-story-scope">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof McpConsentPageMock>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    clientOrigin: "https://claude.ai",
    username: "bob",
    groups: MCP_CONSENT_DEFAULT_GROUPS,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText(/stay connected/i)).toBeNull();
    await expect(canvas.queryByText("offline_access")).toBeNull();
    await expect(canvas.queryByText("Connection")).toBeNull();
    await expect(canvas.queryByText(/signed in as/i)).toBeNull();
    await expect(canvas.getByRole("img", { name: "Signed in as bob" })).toBeTruthy();
    await expect(canvas.getByText("Permissions")).toBeTruthy();
    await expect(canvas.getByText("Choose what this assistant may do.")).toBeTruthy();
    await expect(canvas.getByText(MCP_ASSISTANT_DATA_WARNING_TITLE)).toBeTruthy();
    await expect(canvas.getByText(MCP_ASSISTANT_DATA_WARNING_CONSENT_MESSAGE)).toBeTruthy();
    await expect(canvas.getByRole("button", { name: "Deny" })).toBeTruthy();
    await userEvent.click(canvas.getByRole("button", { name: "Allow" }));
    await expect(canvas.getByRole("status")).toHaveTextContent(/Allow \(mock\)/i);
  },
};

export const UncheckWriteThenApprove: Story = {
  name: "Turn off Write then Allow",
  args: {
    clientOrigin: "https://claude.ai",
    username: "bob",
    groups: MCP_CONSENT_DEFAULT_GROUPS,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const calendarWrite = canvas.getByRole("switch", {
      name: "Create, update, delete, and share calendars and events",
    });
    await userEvent.click(calendarWrite);
    await expect(calendarWrite).toHaveAttribute("aria-checked", "false");
    await expect(canvas.getByRole("switch", { name: "Read calendars and events" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await userEvent.click(canvas.getByRole("button", { name: "Allow" }));
    await expect(canvas.getByRole("status")).toHaveTextContent(/calendar\.read/i);
    await expect(canvas.getByRole("status")).not.toHaveTextContent("calendar.write");
  },
};

export const PartialScopes: Story = {
  name: "Partial scopes",
  args: {
    clientOrigin: "https://chatgpt.com",
    username: "bob",
    groups: mcpConsentGroupsFor(["notes.read", "tasks.read", "tasks.write", "meet.read"]),
  },
};

export const LegacyAlias: Story = {
  name: "Legacy alias",
  args: {
    clientOrigin: "https://claude.ai",
    username: "bob",
    groups: mcpConsentGroupsFor(["calendar.read", "calendar.write", "calendar", "settings"]),
  },
};
