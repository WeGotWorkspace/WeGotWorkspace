import type { Meta, StoryObj } from "@storybook/react-vite";
import { SidebarSection } from "@/sidebar-section/src/sidebar-section";
import { WorkspaceAppSwitcher } from "@/workspace-app-switcher/src/workspace-app-switcher";
import {
  WorkspaceBrandHeader,
  WorkspaceAppLayout,
  WorkspaceSidebar,
  WorkspaceSidebarScrim,
  WorkspaceSidebarToggle,
  WorkspaceUserFooter,
} from "@/workspace-shell/src/workspace-app-layout";

const meta: Meta = {
  title: "Shared/Workspace Shell",
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
        ["--sidebar-logo-close-button-color" as string]: "var(--color-ink)",
        ["--workspace-user-footer-text-color" as string]:
          "color-mix(in oklab, var(--color-ink) 70%, transparent)",
        ["--workspace-user-footer-border-color" as string]:
          "color-mix(in oklab, var(--color-ink) 10%, transparent)",
        ["--workspace-user-footer-avatar-bg" as string]:
          "color-mix(in oklab, var(--color-ink) 12%, transparent)",
        ["--workspace-user-footer-avatar-color" as string]: "var(--color-ink)",
        ["--workspace-user-footer-link-color" as string]:
          "color-mix(in oklab, var(--color-ink) 65%, transparent)",
        ["--workspace-user-footer-link-bg" as string]:
          "color-mix(in oklab, var(--color-ink) 6%, transparent)",
        ["--workspace-user-footer-link-hover-bg" as string]:
          "color-mix(in oklab, var(--color-ink) 18%, transparent)",
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
