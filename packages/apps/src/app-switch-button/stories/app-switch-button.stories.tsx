import type { CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { AppSwitchButton } from "../src/app-switch-button";
import { WorkspaceAppIcon } from "@/lib/workspace-app-icon";
import {
  WORKSPACE_APP_ACCENT,
  WORKSPACE_APP_IDS,
  type WorkspaceAppId,
} from "@/lib/workspace-app-icons";

const meta: Meta<typeof AppSwitchButton> = {
  title: "Layout/App Switch Button",
  component: AppSwitchButton,
  parameters: {
    layout: "centered",
    cssprops: {
      "app-sidebar-color": {
        value: "#ffffff",
        description: "Sidebar label color for the switch lockup",
      },
      "color-paper": { value: "var(--color-paper)", description: "Notes / workspace menu surface" },
      "color-we-got-dark": {
        value: "var(--color-we-got-dark)",
        description: "Primary ink on light surfaces",
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof AppSwitchButton>;

/** In-app trigger: user artwork icon + “we got” / route label. */
export const InApp: Story = {
  parameters: {
    routerPath: "/mail",
  },
};

/** Workspace home / install: inverted suite icon + “we got Workspace” lockup on dark shell. */
export const Workspace: Story = {
  args: {
    subtitle: "Workspace",
  },
  decorators: [
    (Story) => (
      <div
        className="rounded-lg p-4"
        style={
          {
            backgroundColor: "var(--workspace-home-bg, #1b1d3a)",
            color: "#ffffff",
            "--app-switch-label-color": "#ffffff",
          } as CSSProperties
        }
      >
        <Story />
      </div>
    ),
  ],
};

export const CompactWorkspace: Story = {
  args: {
    variant: "compact",
    subtitle: "Workspace",
  },
  decorators: [
    (Story) => (
      <div
        className="rounded-lg p-4"
        style={
          {
            backgroundColor: "var(--workspace-home-bg, #1b1d3a)",
            color: "#ffffff",
            "--app-switch-label-color": "#ffffff",
          } as CSSProperties
        }
      >
        <Story />
      </div>
    ),
  ],
};

/** Compact header in an app shell: user artwork icon + single app name line. */
export const CompactInApp: Story = {
  parameters: {
    routerPath: "/docs",
  },
  args: {
    variant: "compact",
  },
};

export const Disabled: Story = {
  args: {
    ...Workspace.args,
    disabled: true,
  },
};

/** Admin sidebar: white trigger bg + slate glyph (inverted lockup). */
export const AdminTrigger: Story = {
  parameters: {
    routerPath: "/admin",
    cssprops: {
      "app-sidebar-color": { value: "#ffffff" },
    },
  },
  decorators: [
    (Story) => (
      <div
        className="app-sidebar rounded-lg p-4"
        style={{ backgroundColor: "#475569", color: "#ffffff", "--app-sidebar-color": "#ffffff" }}
      >
        <Story />
      </div>
    ),
  ],
};

/** Drive sidebar: dark trigger bg + green glyph (inverted lockup). */
export const DriveTrigger: Story = {
  parameters: {
    routerPath: "/drive",
    cssprops: {
      "app-sidebar-color": { value: "#0f172a" },
    },
  },
  decorators: [
    (Story) => (
      <div
        className="app-sidebar rounded-lg p-4"
        style={{ backgroundColor: "#10b981", color: "#0f172a", "--app-sidebar-color": "#0f172a" }}
      >
        <Story />
      </div>
    ),
  ],
};

/** All workspace app icons at switcher + home tile sizes (exact `/app-icons/` artwork). */
export const AppIcons: Story = {
  render: () => (
    <div className="flex flex-col gap-6 p-4">
      <div className="flex flex-wrap items-end gap-4">
        {WORKSPACE_APP_IDS.map((appId) => (
          <div key={appId} className="flex flex-col items-center gap-2">
            <div
              className="rounded-lg p-1"
              style={
                {
                  "--app-sidebar-color": "#0f172a",
                  "--workspace-accent": WORKSPACE_APP_ACCENT[appId],
                } as CSSProperties
              }
            >
              <WorkspaceAppIcon
                appId={appId}
                className="size-[calc(2*1.875rem*0.85)]"
                variant="switch-trigger"
              />
            </div>
            <span className="text-xs capitalize text-muted-foreground">{appId} trigger</span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-4">
        {WORKSPACE_APP_IDS.map((appId) => (
          <div key={`orig-${appId}`} className="flex flex-col items-center gap-2">
            <WorkspaceAppIcon appId={appId} className="size-[calc(2*1.875rem*0.85)] rounded-lg" />
            <span className="text-xs capitalize text-muted-foreground">{appId} original</span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {WORKSPACE_APP_IDS.map((appId) => (
          <WorkspaceAppIcon
            key={`menu-${appId}`}
            appId={appId as WorkspaceAppId}
            className="size-4 rounded-[4px]"
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        {WORKSPACE_APP_IDS.map((appId) => (
          <WorkspaceAppIcon
            key={`tile-${appId}`}
            appId={appId as WorkspaceAppId}
            className="size-32 rounded-[16px] shadow-lg"
          />
        ))}
      </div>
    </div>
  ),
};
