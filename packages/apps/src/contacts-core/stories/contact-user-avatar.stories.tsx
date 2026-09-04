import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { createContactsAppBootstrap } from "@/lib/api/mock/contacts-bootstrap";
import { addressBookDotColor } from "@/contacts-core/src/contacts-addressbook-color";
import { ContactUserAvatar } from "@/contacts-core/src/contact-user-avatar";
import { ContactsStoryScope } from "./contacts-story-scope";

const bootstrap = createContactsAppBootstrap();
const janeCard = bootstrap.data.cards.find((card) => card.id === "card-jane");
const joeCard = bootstrap.data.cards.find((card) => card.id === "card-joe");
const friendsGroup = bootstrap.data.cards.find((card) => card.id === "card-group-friends");
const acmeCard = bootstrap.data.cards.find((card) => card.id === "card-acme");

const meta = {
  title: "Apps/Contacts/Contact user avatar",
  component: ContactUserAvatar,
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
} satisfies Meta<typeof ContactUserAvatar>;

export default meta;
type Story = StoryObj<typeof ContactUserAvatar>;

export const WithPhoto: Story = {
  tags: ["vitest-ci"],
  args: {
    card: janeCard,
    size: "lg",
    compact: true,
  },
  play: async ({ canvasElement }) => {
    const avatar = canvasElement.querySelector(".contacts-user-avatar") as HTMLElement | null;
    const img = canvasElement.querySelector("img.user-avatar__image");
    await expect(img?.getAttribute("src")).toBe("https://www.example.com/pub/photos/jqpublic.gif");
    await expect(img?.getAttribute("style") ?? "").toBe("");
    await expect(avatar?.style.getPropertyValue("--contacts-book-color")).toBe(
      addressBookDotColor({ id: "default" }),
    );
  },
};

export const InitialsOnly: Story = {
  args: {
    displayName: "Pat Example",
    size: "lg",
    compact: true,
  },
};

export const InitialsFromBook: Story = {
  tags: ["vitest-ci"],
  args: {
    card: joeCard,
    size: "lg",
    compact: true,
  },
  play: async ({ canvasElement }) => {
    const avatar = canvasElement.querySelector(".contacts-user-avatar") as HTMLElement | null;
    await expect(avatar?.style.getPropertyValue("--contacts-book-color")).toBe(
      addressBookDotColor({ id: "work" }),
    );
    await expect(avatar?.style.getPropertyValue("--contacts-book-color")).not.toBe(
      addressBookDotColor({ id: "default" }),
    );
    await expect(canvasElement.querySelector(".user-avatar__mark")?.textContent).toMatch(/J/);
  },
};

export const Group: Story = {
  args: {
    card: friendsGroup,
    size: "lg",
    compact: true,
  },
};

export const Organization: Story = {
  tags: ["vitest-ci"],
  args: {
    card: acmeCard,
    size: "lg",
    compact: true,
  },
  play: async ({ canvasElement }) => {
    const avatar = canvasElement.querySelector(".contacts-user-avatar") as HTMLElement | null;
    await expect(canvasElement.querySelector(".contacts-org-icon")).toBeTruthy();
    await expect(avatar?.style.getPropertyValue("--contacts-book-color")).toBe(
      addressBookDotColor({ id: "default" }),
    );
  },
};
