import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { addressBookDotColor } from "@/contacts-core/src/contacts-addressbook-color";
import { ContactsGroupIcon } from "@/contacts-core/src/contacts-group-icon";
import { ContactsStoryScope } from "./contacts-story-scope";

const meta = {
  title: "Apps/Contacts/Group icon",
  component: ContactsGroupIcon,
  parameters: {
    layout: "centered",
  },
  decorators: [
    (Story) => (
      <ContactsStoryScope>
        <Story />
      </ContactsStoryScope>
    ),
  ],
} satisfies Meta<typeof ContactsGroupIcon>;

export default meta;
type Story = StoryObj<typeof ContactsGroupIcon>;

export const TintedFromBook: Story = {
  tags: ["vitest-ci"],
  args: {
    book: "group-eng",
  },
  play: async ({ canvasElement }) => {
    const icon = canvasElement.querySelector(".contacts-group-icon") as HTMLElement | null;
    await expect(icon).toBeTruthy();
    await expect(icon?.style.getPropertyValue("--collection-row-color")).toBe(
      addressBookDotColor({ id: "group-eng" }),
    );
  },
};

export const NoResolvableBook: Story = {
  tags: ["vitest-ci"],
  play: async ({ canvasElement }) => {
    const icon = canvasElement.querySelector(".contacts-group-icon") as HTMLElement | null;
    await expect(icon).toBeTruthy();
    await expect(icon?.style.getPropertyValue("--collection-row-color")).toBe("");
  },
};
