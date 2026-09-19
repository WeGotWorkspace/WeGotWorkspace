import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { InstallFirstRunAccount } from "@/install-core/src/install-first-run-account";
import { installFirstRunCopy } from "@/install-core/src/install-first-run-copy";
import { InstallFirstRunDatabase } from "@/install-core/src/install-first-run-database";
import { InstallFirstRunReady } from "@/install-core/src/install-first-run-ready";
import { InstallFirstRunServerAttention } from "@/install-core/src/install-first-run-server";
import { InstallFirstRunWelcome } from "@/install-core/src/install-first-run-welcome";
import type { InstallServerCheck } from "@/install-core/src/install-types";

const FAILED_CHECKS: InstallServerCheck[] = [
  {
    id: "php",
    label: "PHP version",
    status: "error",
    detail: "8.1 is installed; 8.2 or newer is required.",
  },
  {
    id: "writable",
    label: "Writable data directory",
    status: "error",
    detail: "wgw-content is not writable.",
  },
];

function progressItems(canvas: ReturnType<typeof within>) {
  return within(canvas.getByRole("list", { name: "Setup progress" })).getAllByRole("listitem");
}

const meta = {
  title: "Apps/Install/First run",
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const Welcome: Story = {
  tags: ["vitest-ci"],
  render: () => <InstallFirstRunWelcome />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: installFirstRunCopy.welcomeTitle }),
    ).toBeInTheDocument();
    await expect(canvas.getByText(installFirstRunCopy.welcomeLead)).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Get started" })).toBeInTheDocument();
    await expect(progressItems(canvas)).toHaveLength(4);
    await expect(canvas.getByText("Welcome, current")).toBeInTheDocument();
    await expect(canvas.getByText("Database")).toBeInTheDocument();
    await expect(canvas.queryByText("we got")).toBeNull();
    await expect(canvas.queryByText(/© .*WeGotWorkspace/)).toBeNull();
    await expect(canvas.queryByText("Files on every device")).toBeNull();
    await expect(canvas.queryByText("On your own server.")).toBeNull();
  },
};

export const Database: Story = {
  name: "Your database",
  tags: ["vitest-ci"],
  render: () => <InstallFirstRunDatabase />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: installFirstRunCopy.databaseTitle }),
    ).toBeInTheDocument();
    await expect(progressItems(canvas)).toHaveLength(4);
    await expect(canvas.getByText("Database, current")).toBeInTheDocument();
    const engines = within(canvas.getByRole("group", { name: "Type" })).getAllByRole("button");
    await expect(engines[0]).toHaveAccessibleName("MySQL / MariaDB");
    await expect(engines[0]).toHaveAttribute("aria-pressed", "true");
    await expect(engines[1]).toHaveAccessibleName("SQLite");
    await expect(canvas.getByLabelText("Host")).toBeInTheDocument();
    await expect(canvas.getByLabelText("Port")).toBeInTheDocument();
    await expect(canvas.getByLabelText("User")).toBeInTheDocument();
    await expect(canvas.getByLabelText("Password")).toBeInTheDocument();
    const panels = canvasElement.querySelectorAll(".install-first-run__engine-panel");
    await expect(panels).toHaveLength(2);
    await expect(panels[1]).toHaveClass("install-first-run__engine-panel--hidden");
    await expect(canvas.queryByLabelText("Database file")).toBeNull();
    await expect(canvas.getByRole("button", { name: "Continue" })).toBeInTheDocument();
  },
};

export const DatabaseSqlite: Story = {
  name: "Your database (SQLite)",
  tags: ["vitest-ci"],
  render: () => <InstallFirstRunDatabase initialEngine="sqlite" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Uses the default SQLite file.")).toBeInTheDocument();
    await expect(canvas.queryByRole("textbox", { name: "Host" })).toBeNull();
    await expect(canvas.getByRole("button", { name: "MySQL / MariaDB" })).toBeInTheDocument();
  },
};

export const Account: Story = {
  name: "Your account",
  tags: ["vitest-ci"],
  render: () => (
    <InstallFirstRunAccount
      initialUsername="jane"
      initialEmail="jane@example.com"
      initialPassword="hunter2hunter"
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: installFirstRunCopy.accountTitle }),
    ).toBeInTheDocument();
    await expect(progressItems(canvas)).toHaveLength(4);
    await expect(canvas.getByText("Database, done")).toBeInTheDocument();
    await expect(canvas.getByText("Your account, current")).toBeInTheDocument();
    await expect(canvas.getByLabelText("Username")).toHaveValue("jane");
    await expect(canvas.getByLabelText("Email")).toHaveValue("jane@example.com");
    await expect(canvas.getByLabelText("Password")).toHaveValue("hunter2hunter");
    await expect(canvas.queryByLabelText("Full name")).toBeNull();
    await expect(canvas.queryByText(/You'll sign in as/)).toBeNull();
    await expect(canvas.getByRole("button", { name: "Show password" })).toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: "Use MySQL / MariaDB" })).toBeNull();
    await expect(canvas.queryByText("we got")).toBeNull();
    await expect(canvas.queryByText(/© .*WeGotWorkspace/)).toBeNull();
  },
};

export const AccountFromEnvironment: Story = {
  name: "Your account (database from environment)",
  tags: ["vitest-ci"],
  render: () => (
    <InstallFirstRunAccount
      initialUsername="jane"
      initialEmail="jane@example.com"
      initialPassword="hunter2hunter"
      includeDatabaseStep={false}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(progressItems(canvas)).toHaveLength(3);
    await expect(canvas.queryByText(/^Database/)).toBeNull();
    await expect(canvas.getByText("Your account, current")).toBeInTheDocument();
    await expect(canvas.getByLabelText("Username")).toHaveValue("jane");
    await expect(canvas.getByLabelText("Email")).toHaveValue("jane@example.com");
  },
};

export const Installing: Story = {
  tags: ["vitest-ci"],
  render: () => (
    <InstallFirstRunAccount
      initialUsername="jane"
      initialEmail="jane@example.com"
      initialPassword="hunter2hunter"
      installing
      progressStepIndex={1}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: installFirstRunCopy.accountTitle }),
    ).toBeInTheDocument();
    await expect(canvas.getByLabelText("Email")).toHaveValue("jane@example.com");
    await expect(canvas.getByText(installFirstRunCopy.installingStatus)).toBeInTheDocument();
  },
};

export const Ready: Story = {
  tags: ["vitest-ci"],
  render: () => <InstallFirstRunReady />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: installFirstRunCopy.readyTitle }),
    ).toBeInTheDocument();
    await expect(canvas.getByText(installFirstRunCopy.readyLead)).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Open workspace" })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Server settings" })).toBeInTheDocument();
    await expect(canvas.queryByText(/Set a From address so invites leave spam/)).toBeNull();
  },
};

export const ServerNeedsAttention: Story = {
  name: "Server needs attention",
  tags: ["vitest-ci"],
  render: () => <InstallFirstRunServerAttention checks={FAILED_CHECKS} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: installFirstRunCopy.serverTitle }),
    ).toBeInTheDocument();
    await expect(canvas.getByText("PHP version")).toBeInTheDocument();
    await expect(canvas.getByText("Writable data directory")).toBeInTheDocument();
    await expect(canvas.queryByText("Optional checks do not block setup.")).toBeNull();
    await expect(canvas.queryByText("IMAP extension")).toBeNull();
    await expect(
      canvas.queryByText("Optional. Mail stays off until you configure it in Admin."),
    ).toBeNull();
    await expect(canvas.getByRole("button", { name: "Re-run checks" })).toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: "Create workspace" })).toBeNull();
    await expect(canvas.queryByRole("list", { name: "Setup progress" })).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: "Re-run checks" }));
  },
};
