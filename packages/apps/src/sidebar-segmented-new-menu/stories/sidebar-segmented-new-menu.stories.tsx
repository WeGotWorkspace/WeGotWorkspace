import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { AppSidebarPrimaryProvider } from "@/app-sidebar/src/app-sidebar-primary";
import { registerBuiltinSettings } from "@/settings-core/src/register-builtin-settings";
import { SidebarSegmentedNewMenu } from "@/sidebar-segmented-new-menu/src/sidebar-segmented-new-menu";

const meta: Meta<typeof SidebarSegmentedNewMenu> = {
  title: "UI/Patterns/Sidebar Segmented New Menu",
  component: SidebarSegmentedNewMenu,
  tags: ["autodocs"],
  args: {
    mainLabel: "New event",
    menuLabel: "More create actions",
    onMainAction: fn(),
    items: [
      { id: "create-calendar", label: "Add calendar", onClick: fn() },
      { id: "subscribe", label: "Subscribe", onClick: fn() },
    ],
  },
  render: (args) => (
    <div className="max-w-xs p-6">
      <SidebarSegmentedNewMenu {...args} />
    </div>
  ),
};

export default meta;
type Story = StoryObj<typeof SidebarSegmentedNewMenu>;

export const Default: Story = {
  tags: ["vitest-ci"],
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "New event" }));
    await expect(args.onMainAction).toHaveBeenCalledOnce();
  },
};

export const MainOnly: Story = {
  args: {
    items: [],
  },
};

/**
 * In the app sidebar (`AppSidebar settingsAppId`): the app's Settings is the last
 * option of the menu, after a separator.
 */
export const WithAppSettings: Story = {
  tags: ["vitest-ci"],
  render: (args) => {
    registerBuiltinSettings();
    return (
      <div className="max-w-xs p-6">
        <AppSidebarPrimaryProvider settingsAppId="notes">
          <SidebarSegmentedNewMenu {...args} />
        </AppSidebarPrimaryProvider>
      </div>
    );
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "More create actions" }));
    const menu = await within(document.body).findByRole("menu");
    const rows = Array.from(menu.querySelectorAll('[role="menuitem"], [role="separator"]'));
    await expect(rows.map((row) => row.getAttribute("role"))).toEqual([
      "menuitem",
      "menuitem",
      "separator",
      "menuitem",
    ]);
    const settings = rows[rows.length - 1] as HTMLElement;
    await expect(settings).toHaveTextContent("Settings");
    await userEvent.click(settings);
    await expect(within(document.body).queryByRole("menu")).toBeNull();
    await expect(args.items?.[0]?.onClick).not.toHaveBeenCalled();
  },
};

/** An app with no other create options: the chevron menu holds just Settings. */
export const SettingsOnly: Story = {
  tags: ["vitest-ci"],
  args: { items: [] },
  render: (args) => {
    registerBuiltinSettings();
    return (
      <div className="max-w-xs p-6">
        <AppSidebarPrimaryProvider settingsAppId="notes">
          <SidebarSegmentedNewMenu {...args} />
        </AppSidebarPrimaryProvider>
      </div>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "More create actions" }));
    const menu = await within(document.body).findByRole("menu");
    await expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((row) => row.textContent),
    ).toEqual(["Settings"]);
    await expect(menu.querySelector('[role="separator"]')).toBeNull();
  },
};
