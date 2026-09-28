import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import { SidebarSection } from "@/sidebar-section/src/sidebar-section";
import { WorkspaceAppSwitcher } from "@/workspace-app-switcher/src/workspace-app-switcher";
import {
  WorkspaceBrandHeader,
  WorkspaceAppLayout,
  WorkspaceSidebar,
  WorkspaceSidebarAccountFooter,
  WorkspaceSidebarScrim,
  WorkspaceSidebarToggle,
  WorkspaceUserFooter,
} from "@/workspace-shell/src/workspace-app-layout";

const namedSession = {
  ...mockWorkspaceSession,
  user: {
    ...mockWorkspaceSession.user,
    displayName: "Demo User",
    username: "demo.user",
  },
};

const meta: Meta = {
  title: "Layout/Workspace Shell",
  tags: ["vitest-ci"],
};

export default meta;
type Story = StoryObj;

export const Default: Story = {
  parameters: {
    routerPath: "/mail",
  },
  render: () => (
    <WorkspaceAppLayout
      style={{
        ["--workspace-root-bg" as string]: "var(--color-paper)",
        ["--sidebar-logo-close-button-color" as string]: "var(--color-we-got-dark)",
        ["--workspace-user-footer-text-color" as string]:
          "color-mix(in oklab, var(--color-we-got-dark) 70%, transparent)",
        ["--workspace-user-footer-border-color" as string]:
          "color-mix(in oklab, var(--color-we-got-dark) 10%, transparent)",
      }}
    >
      <WorkspaceSidebar open>
        <WorkspaceBrandHeader onCloseMobile={() => {}} appSwitcher={<WorkspaceAppSwitcher />} />
        <nav className="flex-1 px-4 space-y-7 overflow-y-auto">
          <SidebarSection
            title="Library"
            items={[
              { label: "All Items", selected: true, onClick: () => {} },
              { label: "Starred", onClick: () => {} },
              { label: "Archive", onClick: () => {} },
            ]}
          />
        </nav>
        <WorkspaceUserFooter name="Elias Linden" initials="EL" onLogoutClick={() => {}} />
      </WorkspaceSidebar>
      <WorkspaceSidebarScrim open={false} onClick={() => {}} />
      <section className="flex-1 p-6">
        <WorkspaceSidebarToggle open onToggle={() => {}} />
        <h2 className="mt-4 text-2xl" style={{ fontFamily: "var(--font-serif)" }}>
          Workspace shell demo
        </h2>
      </section>
    </WorkspaceAppLayout>
  ),
};

export const AccountFooterWithSettings: Story = {
  render: () => (
    <div className="w-64 border">
      <WorkspaceSidebarAccountFooter
        session={namedSession}
        settingsItem={{ label: "Settings", onClick: () => {} }}
        onLogout={() => {}}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "Settings" })).toBeTruthy();
    await expect(canvas.getByRole("button", { name: "Log out" })).toBeTruthy();
  },
};

export const AccountFooterWithoutSettings: Story = {
  render: () => (
    <div className="w-64 border">
      <WorkspaceSidebarAccountFooter session={namedSession} onLogout={() => {}} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole("button", { name: "Settings" })).toBeNull();
    await expect(canvas.getByRole("button", { name: "Log out" })).toBeTruthy();
  },
};
