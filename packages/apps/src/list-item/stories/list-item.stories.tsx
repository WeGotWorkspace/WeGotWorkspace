import type { Meta, StoryObj } from "@storybook/react-vite";
import { Archive, Circle, Star } from "lucide-react";
import { ListItem } from "@/list-item/src/list-item";

const meta: Meta<typeof ListItem> = {
  title: "UI/Primitives/List Item",
  component: ListItem,
};

export default meta;
type Story = StoryObj<typeof ListItem>;

export const NoteStyle: Story = {
  args: {
    id: "note-1",
    title: "The Architecture of Quiet",
    subtitle: "The Journal",
    date: "12 Oct 2024",
    text: "The silence of a library is not the absence of sound, but the presence of focus.",
    icons: [
      <Star
        className="size-3 transition-opacity"
        fill="currentColor"
        style={{ color: "var(--color-emerald)", opacity: 1 }}
      />,
    ],
    isActive: true,
    isSelected: false,
    selectionMode: false,
    isTouch: false,
    isDragging: false,
    onClick: () => {},
    onLongPress: () => {},
    onDragStart: () => {},
    onDragEnd: () => {},
  },
};

export const MailStyleTouch: Story = {
  args: {
    ...NoteStyle.args,
    id: "mail-1",
    subtitle: "Elena Harper",
    title: "Quarterly design review",
    text: "Can we align on the revised timeline before Thursday's call?",
    icons: [
      <Circle
        className="size-2.5"
        fill="currentColor"
        strokeWidth={0}
        style={{ color: "var(--color-emerald)" }}
      />,
      <Star
        className="size-3 transition-opacity"
        fill="currentColor"
        style={{ color: "var(--color-emerald)", opacity: 0.7 }}
      />,
    ],
    isTouch: true,
    swipeLeftAction: {
      icon: <Star className="size-5" fill="currentColor" />,
      color: "var(--color-emerald)",
      label: "Star",
      onActivate: () => {},
    },
    swipeRightAction: {
      icon: <Archive className="size-5" />,
      color: "var(--color-ink)",
      label: "Archive",
      onActivate: () => {},
    },
  },
  render: (args) => (
    <div className="max-w-2xl border rounded-md overflow-hidden">
      <ListItem {...args} />
    </div>
  ),
};
