import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, within } from "storybook/test";
import { Archive, Mail, NotebookPen, Star, Trash2 } from "lucide-react";
import { Button } from "@/button/src/button";
import { DropdownMenu } from "../src/dropdown-menu";
import type { DropdownMenuItemProps } from "../src/dropdown-menu";
import "./menu-dropdown.stories.css";

const meta: Meta<typeof DropdownMenu> = {
  title: "UI/Primitives/Dropdown Menu",
  component: DropdownMenu,
  parameters: {
    layout: "centered",
  },
  args: {
    align: "start",
  },
  argTypes: {
    align: { control: "select", options: ["start", "center", "end"] },
    trigger: { control: false },
    items: { control: false },
  },
};

export default meta;
type Story = StoryObj<typeof DropdownMenu>;

const notesClick = fn();

const baseItems: DropdownMenuItemProps[] = [
  { id: "notes", label: "Notes", icon: <NotebookPen className="size-4" />, onClick: notesClick },
  { id: "mail", label: "Mail", icon: <Mail className="size-4" />, onClick: () => {} },
  { id: "archive", label: "Archive", icon: <Archive className="size-4" />, onClick: () => {} },
];

export const Default: Story = {
  tags: ["vitest-ci"],
  args: {
    contentClassName: "menu-dropdown-story__panel",
  },
  render: (args) => (
    <DropdownMenu
      {...args}
      trigger={<Button label="Open menu" variant="outline" />}
      items={baseItems}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Open menu" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Notes" }));
    await expect(notesClick).toHaveBeenCalledOnce();
  },
};

/**
 * Menus are frosted floating chrome (suite norm), like toasts and the selection
 * bar: frost blur, floating radius, no border, frost shadow.
 */
export const Frosted: Story = {
  tags: ["vitest-ci"],
  render: () => (
    <DropdownMenu trigger={<Button label="Open menu" variant="outline" />} items={baseItems} />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Open menu" }));
    const menu = await screen.findByRole("menu");
    const style = getComputedStyle(menu);
    await expect(style.backdropFilter).toContain("blur");
    await expect(style.borderTopWidth).toBe("0px");
    await expect(style.borderTopLeftRadius).toBe("16px");
    await expect(menu.style.backgroundColor).toBe("");
    await userEvent.keyboard("{Escape}");
  },
};

export const CheckedState: Story = {
  args: {
    ...Default.args,
    contentClassName: "menu-dropdown-story__panel menu-dropdown-story__panel--warm",
  },
  render: (args) => (
    <DropdownMenu
      {...args}
      trigger={<Button label="Open menu" variant="outline" />}
      items={[
        {
          id: "notes",
          label: "Notes",
          icon: <NotebookPen className="size-4" />,
          onClick: () => {},
        },
        {
          id: "mail",
          label: "Mail",
          icon: <Mail className="size-4" />,
          checked: true,
          onClick: () => {},
        },
        { id: "starred", label: "Starred", icon: <Star className="size-4" />, onClick: () => {} },
      ]}
    />
  ),
};

export const WithDangerItem: Story = {
  args: {
    ...Default.args,
  },
  render: (args) => (
    <DropdownMenu
      {...args}
      trigger={<Button label="Open menu" variant="outline" />}
      items={[
        ...baseItems,
        {
          id: "delete",
          label: "Delete",
          icon: <Trash2 className="size-4" />,
          onClick: () => {},
          severity: "danger",
        },
      ]}
    />
  ),
};

export const Disabled: Story = {
  args: {
    ...Default.args,
    disabled: true,
  },
  render: (args) => (
    <DropdownMenu
      {...args}
      trigger={<Button label="Dropdown disabled" variant="outline" disabled />}
      items={baseItems}
    />
  ),
};
