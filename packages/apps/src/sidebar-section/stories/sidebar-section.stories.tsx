import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { Folder, Tag } from "lucide-react";
import { CollectionSidebarRow } from "@/collection-sidebar/src/collection-sidebar-row";
import { SidebarSection } from "../src/sidebar-section";
import { sectionToggleAll } from "../src/section-toggle-all";

const meta: Meta<typeof SidebarSection> = {
  title: "UI/Patterns/Sidebar Section",
  component: SidebarSection,
};

export default meta;
type Story = StoryObj<typeof SidebarSection>;

export const Default: Story = {
  args: {
    title: "Mailboxes",
    items: [
      {
        label: "Inbox",
        icon: <Folder className="size-3.5" />,
        selected: true,
        badge: 12,
        onClick: () => {},
      },
      {
        label: "Tags",
        icon: <Tag className="size-3.5" />,
        selected: false,
        onClick: () => {},
      },
    ],
  },
};

export const WithAddButton: Story = {
  args: {
    ...Default.args,
    onAdd: () => {},
    addLabel: "Add mailbox",
  },
};

export const Untitled: Story = {
  args: {
    ...Default.args,
    title: undefined,
    onAdd: () => {},
    addLabel: "Add mailbox",
  },
};

const LISTS = [
  { id: "personal", name: "Personal", color: "#0ea5e9" },
  { id: "work", name: "Work", color: "#f43f5e" },
  { id: "errands", name: "Errands", color: "#84cc16" },
];

/** Heading dot + label + chevron: the dot shows or hides every row at once. */
function ToggleAllSection() {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set(["work"]));
  const [collapsed, setCollapsed] = useState(false);
  const ids = LISTS.map((list) => list.id);
  return (
    <SidebarSection
      title="Reminders"
      collapsed={collapsed}
      onToggleCollapsed={() => setCollapsed((value) => !value)}
      toggleAll={sectionToggleAll({
        ids,
        isOn: (id) => !hidden.has(id),
        onSetAll: (on) => setHidden(on ? new Set() : new Set(ids)),
        showLabel: "Show all reminders",
        hideLabel: "Hide all reminders",
      })}
    >
      {LISTS.map((list) => (
        <CollectionSidebarRow
          key={list.id}
          name={list.name}
          color={list.color}
          visible={!hidden.has(list.id)}
          onToggleVisibility={() =>
            setHidden((current) => {
              const next = new Set(current);
              if (next.has(list.id)) next.delete(list.id);
              else next.add(list.id);
              return next;
            })
          }
        />
      ))}
    </SidebarSection>
  );
}

export const WithToggleAll: Story = {
  tags: ["vitest-ci"],
  render: () => (
    <div className="app-sidebar" style={{ width: 260 }}>
      <ToggleAllSection />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const all = canvas.getByRole("checkbox", { name: "Show all reminders" });
    await expect(all).toHaveAttribute("aria-checked", "mixed");
    await userEvent.click(all);
    await expect(canvas.getByRole("checkbox", { name: "Hide Work" })).toBeTruthy();
    // Keyboard: Space on the focused dot hides everything.
    const hideAll = canvas.getByRole("checkbox", { name: "Hide all reminders" });
    hideAll.focus();
    await userEvent.keyboard(" ");
    await expect(canvas.getByRole("checkbox", { name: "Show all reminders" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    await expect(canvas.getByRole("checkbox", { name: "Show Personal" })).toBeTruthy();
  },
};
