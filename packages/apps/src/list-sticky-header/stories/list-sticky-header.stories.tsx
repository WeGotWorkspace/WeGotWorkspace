import type { Meta, StoryObj } from "@storybook/react-vite";
import { ListStickyHeader } from "@/list-sticky-header/src/list-sticky-header";
import "./list-sticky-header.stories.css";

const meta = {
  title: "Shared/List Sticky Header",
  component: ListStickyHeader,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Sticky section row used by contacts letter groups and chat day separators. Date labels split into a bold lead and regular rest (same treatment as calendar list headings). Scroll the list stories to confirm the hairline + label stay pinned until the next section.",
      },
    },
  },
  argTypes: {
    children: { control: "text" },
    id: { control: "text" },
    className: { control: false },
  },
} satisfies Meta<typeof ListStickyHeader>;

export default meta;
type Story = StoryObj<typeof ListStickyHeader>;

export const Default: Story = {
  args: {
    children: "A",
  },
};

const LETTERS = ["A", "B", "C"] as const;

export const ContactsLetters: Story = {
  name: "Contacts letters",
  render: () => (
    <div className="list-sticky-header-story-scroll">
      {LETTERS.map((letter) => (
        <section key={letter} aria-labelledby={`list-sticky-story-${letter}`}>
          <ListStickyHeader id={`list-sticky-story-${letter}`}>{letter}</ListStickyHeader>
          {Array.from({ length: 8 }, (_, index) => (
            <div key={index} className="list-sticky-header-story-row">
              {letter} contact {index + 1}
            </div>
          ))}
        </section>
      ))}
    </div>
  ),
};

export const ChatDays: Story = {
  name: "Chat days",
  render: () => (
    <div className="list-sticky-header-story-scroll list-sticky-header-story-scroll--chat">
      {(
        [
          { emphasis: "Yesterday", rest: "Aug 31" },
          { emphasis: "Today", rest: "Sep 1" },
        ] as const
      ).map(({ emphasis, rest }) => (
        <section key={emphasis} aria-labelledby={`list-sticky-story-day-${emphasis}`}>
          <ListStickyHeader
            id={`list-sticky-story-day-${emphasis}`}
            label={`${emphasis} ${rest}`}
            emphasis={emphasis}
            rest={rest}
          />
          {Array.from({ length: 10 }, (_, index) => (
            <div key={index} className="list-sticky-header-story-row">
              {emphasis} message {index + 1}
            </div>
          ))}
        </section>
      ))}
    </div>
  ),
};
