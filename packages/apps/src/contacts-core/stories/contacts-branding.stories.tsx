import type { Meta, StoryObj } from "@storybook/react-vite";
import { createBrandingStoryMeta } from "@/branding-playground";
import { createContactsAppBootstrap } from "@/lib/api/mock/contacts-bootstrap";
import { ContactsWorkspace } from "@/contacts-core/src/contacts-workspace";
import { createContactsStoryOperations } from "./contacts-pane-stories.harness";

const bootstrap = createContactsAppBootstrap();
const operations = createContactsStoryOperations(bootstrap.data.cards);

const brandingMeta = createBrandingStoryMeta({
  appId: "contacts",
  workspaceClass: "contacts-workspace",
  accentToken: "contacts-accent",
  component: ContactsWorkspace,
});

const meta = {
  ...brandingMeta,
  title: "Branding/Contacts",
  tags: ["vitest-ci"],
} satisfies Meta<typeof ContactsWorkspace>;

export default meta;
type Story = StoryObj<typeof ContactsWorkspace>;

export const Default: Story = {
  args: {
    ...bootstrap,
    listLoading: false,
    operations,
    onRefreshList: () => {},
  },
};
