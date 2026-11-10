import { useEffect, useState, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { pushWgwApiRuntime } from "@/lib/api/wgw/wgw-api-runtime";
import { registerBuiltinSettings } from "@/settings-core/src/register-builtin-settings";
import { AppSidebarPrimaryProvider } from "@/app-sidebar/src/app-sidebar-primary";
import type { WorkspaceAppId } from "@/lib/workspace-app-icons";
import { SidebarSegmentedNewMenu } from "@/sidebar-segmented-new-menu/src/sidebar-segmented-new-menu";

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

/** An app sidebar's primary button: the app's Settings is the last option of its menu. */
function SidebarPrimary({ appId }: { appId: WorkspaceAppId }) {
  return (
    <AppSidebarPrimaryProvider settingsAppId={appId}>
      <SidebarSegmentedNewMenu mainLabel="New" menuLabel="More options" onMainAction={() => {}} />
    </AppSidebarPrimaryProvider>
  );
}

async function openSettings(canvasElement: HTMLElement) {
  await userEvent.click(within(canvasElement).getByRole("button", { name: "More options" }));
  const body = within(canvasElement.ownerDocument.body);
  await userEvent.click(await body.findByRole("menuitem", { name: "Settings" }));
}

const meta: Meta<typeof SidebarPrimary> = {
  title: "Features/Settings/Dialog",
  component: SidebarPrimary,
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
type Story = StoryObj<typeof SidebarPrimary>;

/** Settings alone makes the primary a split button. */
export const VisibleForCalendar: Story = {
  args: {
    appId: "calendar",
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "More options" }));
    const body = within(canvasElement.ownerDocument.body);
    await expect(body.findByRole("menuitem", { name: "Settings" })).resolves.toBeTruthy();
  },
};

/** No settings panel: a plain primary button, no menu. */
export const HiddenForDrive: Story = {
  args: {
    appId: "drive",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole("button", { name: "More options" })).toBeNull();
    await expect(canvas.getByRole("button", { name: "New" })).toBeTruthy();
  },
};

export const CalendarPanel: Story = {
  args: {
    appId: "calendar",
  },
  play: async ({ canvasElement }) => {
    await openSettings(canvasElement);
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
    await openSettings(canvasElement);
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
    await openSettings(canvasElement);
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
    await openSettings(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    await expect(body.findByRole("heading", { name: "Notes" })).resolves.toBeTruthy();
    const trigger = await body.findByRole("button", { name: /Default notebook: The Journal/i });
    await expect(trigger.textContent).toContain("The Journal");
  },
};
