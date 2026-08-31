import type { Meta, StoryObj } from "@storybook/react-vite";
import { createContactsAppBootstrap } from "@/lib/api/mock/contacts-bootstrap";
import { ContactUserAvatar } from "@/contacts-core/src/contact-user-avatar";
import { ContactsStoryScope } from "./contacts-story-scope";

const janeCard = createContactsAppBootstrap().data.cards.find((card) => card.id === "card-jane");
const friendsGroup = createContactsAppBootstrap().data.cards.find(
  (card) => card.id === "card-group-friends",
);
const acmeCard = createContactsAppBootstrap().data.cards.find((card) => card.id === "card-acme");

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
  args: {
    card: janeCard,
    size: "lg",
  },
};

export const InitialsOnly: Story = {
  args: {
    displayName: "Pat Example",
    size: "lg",
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
  args: {
    card: acmeCard,
    size: "lg",
    compact: true,
  },
};
