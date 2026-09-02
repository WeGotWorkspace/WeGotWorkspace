import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, within } from "storybook/test";
import { ContactsAddressBookSelect } from "@/contacts-core/src/contacts-address-book-select";
import { defaultContactsLabels } from "@/contacts-core/src/contacts-labels";
import { ContactsStoryScope } from "./contacts-story-scope";

const seedBooks = [
  { id: "default", name: "Ada", isDefault: true as const },
  { id: "group-eng", name: "Engineering" },
  { id: "shared-99", name: "Bob", isSharee: true },
];

function ContactsAddressBookSelectHarness({
  variant = "toolbar",
  disabled = false,
  onValueChange,
}: {
  variant?: "field" | "toolbar";
  disabled?: boolean;
  onValueChange: (bookId: string) => void;
}) {
  const [value, setValue] = useState("default");

  return (
    <ContactsStoryScope>
      <ContactsAddressBookSelect
        id="story-address-book"
        variant={variant}
        label={
          variant === "toolbar"
            ? defaultContactsLabels.toolbarMoveToAddressBook
            : defaultContactsLabels.createGroupAddressBookLabel
        }
        books={seedBooks}
        value={value}
        disabled={disabled}
        onValueChange={(next) => {
          setValue(next);
          onValueChange(next);
        }}
      />
    </ContactsStoryScope>
  );
}

const meta: Meta<typeof ContactsAddressBookSelectHarness> = {
  title: "Apps/Contacts/Components/ContactsAddressBookSelect",
  component: ContactsAddressBookSelectHarness,
  tags: ["autodocs"],
  args: {
    onValueChange: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof ContactsAddressBookSelectHarness>;

export const Toolbar: Story = {
  tags: ["vitest-ci"],
  args: { variant: "toolbar" },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("combobox", {
      name: defaultContactsLabels.toolbarMoveToAddressBook,
    });
    await expect(trigger).toHaveTextContent(defaultContactsLabels.personalAddressBook);

    await userEvent.click(trigger);
    const options = await screen.findAllByRole("option");
    await expect(options.map((option) => option.textContent?.trim())).toEqual([
      defaultContactsLabels.personalAddressBook,
      "Engineering",
      "Bob",
    ]);
    await expect(document.querySelector(".contacts-address-book-select__separator")).toBeNull();
    await expect(document.querySelectorAll(".notes-notebook-color-icon").length).toBeGreaterThan(0);
    await expect(document.querySelector(".contacts-group-icon")).toBeNull();

    await userEvent.click(screen.getByRole("option", { name: "Engineering" }));
    await expect(args.onValueChange).toHaveBeenCalledWith("group-eng");
  },
};

export const Field: Story = {
  args: { variant: "field" },
};

export const Disabled: Story = {
  args: { variant: "toolbar", disabled: true },
};
