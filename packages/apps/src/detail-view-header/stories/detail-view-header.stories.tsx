import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { BookOpen, CalendarDays, Inbox } from "lucide-react";
import { DetailViewHeader } from "@/detail-view-header/src/detail-view-header";

const meta: Meta<typeof DetailViewHeader> = {
  title: "UI/Patterns/Detail View Header",
  component: DetailViewHeader,
};

export default meta;
type Story = StoryObj<typeof DetailViewHeader>;

export const ReadonlyMailStyle: Story = {
  args: {
    topTags: [
      {
        key: "mailbox",
        label: "Inbox",
        icon: <Inbox className="size-3.5 opacity-70" />,
        colors: {
          color: "var(--color-we-got-soft)",
          backgroundColor: "color-mix(in oklab, var(--color-we-got-dark) 88%, transparent)",
        },
      },
      {
        key: "date",
        label: "Thu, 07 May 2026, 22:34",
        icon: <CalendarDays className="size-3.5 opacity-70" />,
        colors: {
          backgroundColor: "color-mix(in oklab, var(--color-we-got-dark) 6%, transparent)",
          color: "color-mix(in oklab, var(--color-we-got-dark) 58%, transparent)",
        },
      },
    ],
    title: "Weekly planning and architecture follow-up",
    emptyTitleLabel: "(no subject)",
    titleClassName:
      "text-3xl md:text-4xl font-sans text-(--color-we-got-dark) font-semibold leading-[1.1] tracking-tight mb-8",
  },
};

export const EditableNotesStyle: Story = {
  render: () => {
    const [title, setTitle] = useState("How to keep notes architecture DRY");
    return (
      <DetailViewHeader
        topTags={[
          {
            key: "notebook",
            label: "General",
            icon: <BookOpen className="size-3.5 opacity-70" />,
            wrapperClassName: "max-w-[260px]",
          },
          {
            key: "edited",
            label: "Last edited Thu, 07 May 2026, 22:34",
            icon: <CalendarDays className="size-3.5 opacity-70" />,
            colors: {
              backgroundColor: "color-mix(in oklab, var(--color-we-got-dark) 6%, transparent)",
              color: "color-mix(in oklab, var(--color-we-got-dark) 58%, transparent)",
            },
          },
        ]}
        title={title}
        editable
        onTitleChange={setTitle}
        titleKey="editable-notes-title"
        titleClassName="text-3xl md:text-4xl font-semibold leading-[1.1] tracking-tight mb-8 md:mb-10"
        titleStyle={{ fontFamily: "var(--font-sans)", color: "var(--color-we-got-dark)" }}
        titlePlaceholder="Untitled"
      />
    );
  },
};
