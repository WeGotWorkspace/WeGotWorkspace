import { useEffect, useState, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { pushWgwApiRuntime } from "@/lib/api/wgw/wgw-api-runtime";
import { registerBuiltinSettings } from "@/settings-core/src/register-builtin-settings";
import {
  WorkspaceAppPrimarySidebarSection,
  WorkspaceAppSettingsSidebarSection,
} from "@/settings-core/src/workspace-app-settings-sidebar";

registerBuiltinSettings();

/** This file is a mock session. A dev `.env.local` live flag must not swap in real notebooks. */
function MockApiStory({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const pop = pushWgwApiRuntime({ baseUrl: "/api/v1", useLiveApi: false });
    setReady(true);
    return pop;
  }, []);
  if (!ready) return null;
  return children;
}

const meta: Meta<typeof WorkspaceAppSettingsSidebarSection> = {
  title: "Features/Settings/Dialog",
  component: WorkspaceAppSettingsSidebarSection,
  parameters: {
    layout: "padded",
  },
  decorators: [
    (Story) => (
      <MockApiStory>
        <Story />
      </MockApiStory>
    ),
  ],
  tags: ["vitest-ci"],
};

export default meta;
type Story = StoryObj<typeof WorkspaceAppSettingsSidebarSection>;

export const VisibleForCalendar: Story = {
  args: {
    appId: "calendar",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "Settings" })).toBeTruthy();
  },
};

/** An app's first sidebar section: its own rows, then Settings as the last row. */
export const PrimarySectionWithSettings: Story = {
  args: { appId: "tasks" },
  render: ({ appId }) => (
    <WorkspaceAppPrimarySidebarSection
      appId={appId}
      items={[
        { label: "All Tasks", onClick: () => {} },
        { label: "Today", onClick: () => {} },
      ]}
    />
  ),
  play: async ({ canvasElement }) => {
    const rows = within(canvasElement).getAllByRole("button");
    await expect(rows.map((row) => row.textContent)).toEqual(["All Tasks", "Today", "Settings"]);
  },
};

/** No Settings row for an app without a settings panel. */
export const PrimarySectionWithoutSettings: Story = {
  args: { appId: "drive" },
  render: ({ appId }) => (
    <WorkspaceAppPrimarySidebarSection
      appId={appId}
      items={[{ label: "My Drive", onClick: () => {} }]}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "My Drive" })).toBeTruthy();
    await expect(canvas.queryByRole("button", { name: "Settings" })).toBeNull();
  },
};

export const HiddenForDrive: Story = {
  args: {
    appId: "drive",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole("button", { name: "Settings" })).toBeNull();
  },
};

export const CalendarPanel: Story = {
  args: {
    appId: "calendar",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Settings" }));
    const body = within(canvasElement.ownerDocument.body);
    await expect(body.findByRole("heading", { name: "Calendar" })).resolves.toBeTruthy();
    await expect(body.findByRole("combobox", { name: "Timezone" })).resolves.toBeTruthy();
    await expect(body.findByRole("combobox", { name: "Week starts on" })).resolves.toBeTruthy();
    await expect(body.findByRole("combobox", { name: "Visible hours" })).resolves.toBeTruthy();
    await expect(body.queryByRole("combobox", { name: "Day starts on" })).toBeNull();
    const footer = canvasElement.ownerDocument.querySelector(".ui-modal-footer");
    expect(footer).toBeInstanceOf(HTMLElement);
    const footerQueries = within(footer as HTMLElement);
    await expect(footerQueries.findByRole("button", { name: "Save" })).resolves.toBeTruthy();
    await expect(footerQueries.getByRole("button", { name: "Open in Settings" })).toBeTruthy();
    await expect(footerQueries.getByRole("button", { name: "Cancel" })).toBeTruthy();
  },
};

export const TasksPanel: Story = {
  args: {
    appId: "tasks",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Settings" }));
    const body = within(canvasElement.ownerDocument.body);
    await expect(body.findByRole("heading", { name: "Tasks" })).resolves.toBeTruthy();
    const trigger = await body.findByRole("button", { name: /Default list: Inbox/i });
    await expect(trigger.textContent).toContain("Inbox");
  },
};

export const ContactsPanel: Story = {
  args: {
    appId: "contacts",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Settings" }));
    const body = within(canvasElement.ownerDocument.body);
    await expect(body.findByRole("heading", { name: "Contacts" })).resolves.toBeTruthy();
    const trigger = await body.findByRole("button", { name: /Default address book: Personal/i });
    await expect(trigger.textContent).toContain("Personal");
  },
};

export const NotesPanel: Story = {
  args: {
    appId: "notes",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Settings" }));
    const body = within(canvasElement.ownerDocument.body);
    await expect(body.findByRole("heading", { name: "Notes" })).resolves.toBeTruthy();
    const trigger = await body.findByRole("button", { name: /Default notebook: The Journal/i });
    await expect(trigger.textContent).toContain("The Journal");
  },
};
