import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, within } from "storybook/test";
import { ContactsNewMenu } from "@/contacts-core/src/contacts-new-menu";
import { defaultContactsLabels } from "@/contacts-core/src/contacts-labels";
import { ContactsStoryScope } from "./contacts-story-scope";

const meta = {
  title: "Apps/Contacts/Components/ContactsNewMenu",
  component: ContactsNewMenu,
  tags: ["autodocs"],
  args: {
    labels: defaultContactsLabels,
    onCreateContact: fn(),
    onCreateGroup: fn(),
    onImportVcf: fn(),
  },
  render: (args) => (
    <ContactsStoryScope>
      <div className="app-sidebar__scroll max-w-xs">
        <ContactsNewMenu {...args} />
      </div>
    </ContactsStoryScope>
  ),
} satisfies Meta<typeof ContactsNewMenu>;

export default meta;
type Story = StoryObj<typeof ContactsNewMenu>;

export const Default: Story = {
  tags: ["vitest-ci"],
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const main = canvas.getByRole("button", { name: defaultContactsLabels.newContact });
    await userEvent.click(main);
    await expect(args.onCreateContact).toHaveBeenCalledOnce();

    await userEvent.click(
      canvas.getByRole("button", { name: defaultContactsLabels.newContactMenu }),
    );
    await userEvent.click(screen.getByRole("button", { name: defaultContactsLabels.newGroup }));
    await expect(args.onCreateGroup).toHaveBeenCalledOnce();

    await userEvent.click(
      canvas.getByRole("button", { name: defaultContactsLabels.newContactMenu }),
    );
    await userEvent.click(screen.getByRole("button", { name: defaultContactsLabels.importVcf }));
    await expect(args.onImportVcf).toHaveBeenCalledOnce();
  },
};

export const ContactOnly: Story = {
  args: {
    onCreateGroup: undefined,
    onImportVcf: undefined,
  },
};
