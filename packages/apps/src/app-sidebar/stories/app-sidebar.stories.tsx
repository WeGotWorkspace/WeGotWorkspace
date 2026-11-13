import { useState, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { Folder } from "lucide-react";
import { Button } from "@/button/src/button";
import { NotificationsInboxValueProvider } from "@/notifications-core/src/notifications-inbox-context";
import { SidebarSection } from "@/sidebar-section/src/sidebar-section";
import { WorkspaceUserFooter } from "@/workspace-shell/src/workspace-app-layout";
import { SidebarSegmentedNewMenu } from "@/sidebar-segmented-new-menu/src/sidebar-segmented-new-menu";
import type { WorkspaceAppId } from "@/lib/workspace-app-icons";
import { AppSidebar } from "../src/app-sidebar";
import { Pencil } from "lucide-react";

function AppSidebarHarness({
  settingsAppId,
  primaryButton,
}: {
  settingsAppId?: WorkspaceAppId;
  primaryButton?: ReactNode;
}) {
  const [selected, setSelected] = useState("Inbox");

  return (
    <NotificationsInboxValueProvider
      value={{
        items: [],
        unreadCount: 0,
        onOpenItem: () => {},
        onMarkAllRead: () => {},
        markReadWhere: async () => {},
        onEnablePush: () => {},
        pushEnabled: true,
        soundMuted: false,
        onToggleSoundMute: () => {},
        unreadArrivalNonce: 0,
      }}
    >
      <AppSidebar
        open
        onCloseMobile={() => {}}
        settingsAppId={settingsAppId}
        primaryButton={
          primaryButton ?? (
            <Button
              label="Compose"
              onClick={() => {}}
              size="md"
              pill
              variant="primary"
              icon={<Pencil />}
            />
          )
        }
        children={
          <SidebarSection
            title="Mailboxes"
            items={[
              {
                label: "Inbox",
                icon: <Folder className="size-3.5" />,
                selected: selected === "Inbox",
                onClick: () => setSelected("Inbox"),
              },
              {
                label: "Drafts",
                icon: <Folder className="size-3.5" />,
                selected: selected === "Drafts",
                onClick: () => setSelected("Drafts"),
              },
            ]}
          />
        }
        footer={<WorkspaceUserFooter name="Demo User" initials="DU" onLogoutClick={() => {}} />}
      />
    </NotificationsInboxValueProvider>
  );
}

const meta: Meta<typeof AppSidebarHarness> = {
  title: "Layout/App Sidebar",
  component: AppSidebarHarness,
  parameters: {
    layout: "fullscreen",
    routerPath: "/notes",
  },
};

export default meta;
type Story = StoryObj<typeof AppSidebarHarness>;

export const Default: Story = {
  tags: ["vitest-ci"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "Notifications" })).toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: "Close menu" })).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: "Drafts" }));
    await expect(canvas.getByRole("button", { name: "Drafts" })).toHaveClass(/menu-item--selected/);
  },
};

/**
 * `settingsAppId`: the app's Settings is the last option of the primary button's
 * menu, after the app's own create options.
 */
export const WithAppSettings: Story = {
  tags: ["vitest-ci"],
  render: () => {
    return (
      <AppSidebarHarness
        settingsAppId="notes"
        primaryButton={
          <SidebarSegmentedNewMenu
            mainLabel="New note"
            menuLabel="More create actions"
            onMainAction={() => {}}
            items={[{ id: "new-notebook", label: "New notebook", onClick: () => {} }]}
          />
        }
      />
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "More create actions" }));
    const menu = await within(document.body).findByRole("menu");
    const options = within(menu).getAllByRole("menuitem");
    await expect(options.map((option) => option.textContent)).toEqual(["New notebook", "Settings"]);
    await expect(menu.querySelector('[role="separator"]')).not.toBeNull();
    await userEvent.keyboard("{Escape}");
  },
};

/** Without `settingsAppId` the same primary button has no Settings option. */
export const WithoutAppSettings: Story = {
  tags: ["vitest-ci"],
  render: () => (
    <AppSidebarHarness
      primaryButton={
        <SidebarSegmentedNewMenu
          mainLabel="New note"
          menuLabel="More create actions"
          onMainAction={() => {}}
          items={[{ id: "new-notebook", label: "New notebook", onClick: () => {} }]}
        />
      }
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "More create actions" }));
    const menu = await within(document.body).findByRole("menu");
    await expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((o) => o.textContent),
    ).toEqual(["New notebook"]);
    await userEvent.keyboard("{Escape}");
  },
};
