import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { Folder } from "lucide-react";
import { Button } from "@/button/src/button";
import { NotificationsInboxValueProvider } from "@/notifications-core/src/notifications-inbox-context";
import { SidebarSection } from "@/sidebar-section/src/sidebar-section";
import { WorkspaceUserFooter } from "@/workspace-shell/src/workspace-app-layout";
import { AppSidebar } from "../src/app-sidebar";
import { Pencil } from "lucide-react";

function AppSidebarHarness() {
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
        primaryButton={
          <Button
            label="Compose"
            onClick={() => {}}
            size="xl"
            pill
            variant="primary"
            icon={<Pencil />}
            className="w-full"
          />
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
    routerPath: "/mail",
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
