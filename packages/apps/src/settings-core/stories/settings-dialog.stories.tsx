import { useEffect, useState, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import { pushWgwApiRuntime } from "@/lib/api/wgw/wgw-api-runtime";
import { registerBuiltinSettings } from "@/settings-core/src/register-builtin-settings";
import { WorkspaceAppSettingsFooter } from "@/settings-core/src/workspace-app-settings-footer";

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

const namedSession = {
  ...mockWorkspaceSession,
  user: {
    ...mockWorkspaceSession.user,
    displayName: "Demo User",
    username: "demo.user",
  },
};

const meta: Meta<typeof WorkspaceAppSettingsFooter> = {
  title: "Features/Settings/Dialog",
  component: WorkspaceAppSettingsFooter,
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
type Story = StoryObj<typeof WorkspaceAppSettingsFooter>;

export const VisibleForCalendar: Story = {
  args: {
    appId: "calendar",
    session: namedSession,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "Settings" })).toBeTruthy();
    await expect(canvas.getByRole("button", { name: "Log out" })).toBeTruthy();
  },
};

export const HiddenForDrive: Story = {
  args: {
    appId: "drive",
    session: namedSession,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole("button", { name: "Settings" })).toBeNull();
    await expect(canvas.getByRole("button", { name: "Log out" })).toBeTruthy();
  },
};

export const CalendarPanel: Story = {
  args: {
    appId: "calendar",
    session: namedSession,
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
    session: namedSession,
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
    session: namedSession,
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
    session: namedSession,
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
