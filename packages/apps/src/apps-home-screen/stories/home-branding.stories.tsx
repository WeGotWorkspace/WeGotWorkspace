import type { Meta, StoryObj } from "@storybook/react-vite";
import { AppsHomeScreen } from "../src/apps-home-screen";
import { createBrandingStoryMeta } from "@/branding-playground";
import { WorkspaceAppIcon } from "@/lib/workspace-app-icon";
import { orderedWorkspaceHomeApps } from "@/wegotworkspace/src/wegotworkspace-home-apps";
import { WorkspaceShellHeader } from "@/workspace-shell/src/workspace-shell-header";

const HOME_APPS = orderedWorkspaceHomeApps(() => {});

const brandingMeta = createBrandingStoryMeta({
  appId: "home",
  workspaceClass: "",
  parameters: {
    routerPath: "/",
    docs: {
      description: {
        component:
          "Designer branding for suite home: cream/ink (and `--workspace-home-bg`) via cssprops, " +
          "home icon SVG slot (`iconPreset` / `svgMarkup` → `WorkspaceHomeIcon` used by BrandLockup), " +
          "and the dashboard tile grid. The suite mark does not use `--wai-*` layers by default — " +
          "paste custom SVG with fixed fills or `var(--color-we-got-soft)` / `var(--color-we-got-dark)` as needed.",
      },
    },
  },
});

const meta = {
  ...brandingMeta,
  title: "Themes/Home",
  tags: ["vitest-ci"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Static BrandLockup (cream suite mark) + home tile grid.
 * SVG slot overrides the lockup; cream/ink cssprops retarget the shell.
 */
export const Default: Story = {
  name: "Home",
  render: () => (
    <section className="apps-home-screen flex w-full min-h-dvh flex-col">
      <WorkspaceShellHeader brandLockup />
      <div className="flex flex-1 items-center justify-center px-6 py-10 md:px-10 md:py-14">
        <div className="grid w-full max-w-5xl grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4">
          {HOME_APPS.map((app) => (
            <button
              key={app.id}
              type="button"
              className="group flex w-full min-h-48 flex-col items-center justify-center gap-4 rounded-3xl p-3 text-center transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-we-got-dark) focus-visible:ring-offset-2"
              aria-label={app.label}
            >
              {app.appId ? (
                <span className="apps-home-screen__tile-icon">
                  <WorkspaceAppIcon appId={app.appId} variant="tile" />
                </span>
              ) : null}
              <span className="text-sm font-medium">{app.label}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  ),
};

/** Signed-in home: AppSwitcher suite lockup (same `WorkspaceHomeIcon`) + tiles. */
export const SignedIn: Story = {
  name: "Signed-in home",
  render: () => (
    <AppsHomeScreen
      apps={HOME_APPS}
      showUserMenu
      userDisplayName="Elias Linden"
      onLogout={() => {}}
    />
  ),
};
