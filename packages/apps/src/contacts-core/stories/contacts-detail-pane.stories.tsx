import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { createContactsAppBootstrap } from "@/lib/api/mock/contacts-bootstrap";
import {
  addressesAfterFieldChange,
  emailsAfterAddressChange,
  phonesAfterNumberChange,
  urlsAfterUriChange,
} from "@/contacts-core/src/contact-channel-commit";
import { contactDetailGroupTags } from "@/contacts-core/src/contacts-detail-groups";
import { ContactsDetailView } from "@/contacts-core/src/contacts-detail-view";
import { listContactGroups } from "@/contacts-core/src/contacts-group-utils";
import { defaultContactsLabels } from "@/contacts-core/src/contacts-labels";
import {
  CONTACT_CHANNEL_DEFAULT_CONTEXT,
  contactCardToEditDraft,
  emptyContactEditDraft,
  newContactMapId,
} from "@/contacts-core/src/contacts-edit-utils";
import { ContactsStoryScope } from "./contacts-story-scope";

function ContactsDetailPaneHarness({
  readOnly = false,
  createMode = false,
}: {
  readOnly?: boolean;
  createMode?: boolean;
}) {
  const bootstrap = createContactsAppBootstrap();
  const card = createMode ? undefined : bootstrap.data.cards[0];
  const groups = listContactGroups(bootstrap.data.cards);
  const groupTagsModel = contactDetailGroupTags({
    card,
    createMode,
    groups,
    allCards: bootstrap.data.cards,
    addressBooks: bootstrap.data.addressBooks,
    hasOperations: true,
    canCreateGroup: !readOnly,
  });
  const [editDraft, setEditDraft] = useState(() =>
    createMode || !card ? emptyContactEditDraft() : contactCardToEditDraft(card),
  );
  /** "Add phone" and friends, as the controller does them: an empty row, its id back. */
  const addRow = (patch: (prev: typeof editDraft, id: string) => typeof editDraft) => () => {
    const id = newContactMapId();
    setEditDraft((prev) => patch(prev, id));
    return id;
  };

  return (
    <ContactsStoryScope variant="detail">
      <ContactsDetailView
        labels={defaultContactsLabels}
        card={card}
        createMode={createMode}
        readOnly={readOnly}
        // Read-only: no editing draft, the sheet shows the card's own values.
        editDraft={readOnly ? null : editDraft}
        displayName={card?.name?.full ?? defaultContactsLabels.newContact}
        groupTags={
          groupTagsModel.show
            ? {
                assigned: groupTagsModel.assigned,
                suggestions: groupTagsModel.suggestions,
                readonly: readOnly || groupTagsModel.readonly,
                allowCreate: !readOnly && groupTagsModel.allowCreate,
                onAdd: () => undefined,
                onRemove: () => undefined,
              }
            : undefined
        }
        onDraftChange={(patch) => setEditDraft((prev) => ({ ...prev, ...patch }))}
        onUpdatePhone={(id, number, phoneType) =>
          setEditDraft((prev) => ({
            ...prev,
            phones: phonesAfterNumberChange({
              phones: prev.phones,
              rowId: id,
              number,
              phoneType,
            }),
          }))
        }
        onUpdateEmail={(id, address, contextType) =>
          setEditDraft((prev) => ({
            ...prev,
            emails: emailsAfterAddressChange({
              emails: prev.emails,
              rowId: id,
              address,
              contextType,
            }),
          }))
        }
        onUpdatePhoneContext={(id, phoneType) =>
          setEditDraft((prev) => ({
            ...prev,
            phones: prev.phones.map((row) => (row.id === id ? { ...row, phoneType } : row)),
          }))
        }
        onUpdateEmailContext={(id, contextType) =>
          setEditDraft((prev) => ({
            ...prev,
            emails: prev.emails.map((row) => (row.id === id ? { ...row, contextType } : row)),
          }))
        }
        onUpdateAddress={(id, field, value, contextType) =>
          setEditDraft((prev) => ({
            ...prev,
            addresses: addressesAfterFieldChange({
              addresses: prev.addresses,
              rowId: id,
              field,
              value,
              contextType,
            }),
          }))
        }
        onUpdateAddressContext={(id, contextType) =>
          setEditDraft((prev) => ({
            ...prev,
            addresses: prev.addresses.map((row) => (row.id === id ? { ...row, contextType } : row)),
          }))
        }
        onUpdateUrl={(id, uri, contextType) =>
          setEditDraft((prev) => ({
            ...prev,
            urls: urlsAfterUriChange({ urls: prev.urls, rowId: id, uri, contextType }),
          }))
        }
        onUpdateUrlContext={(id, contextType) =>
          setEditDraft((prev) => ({
            ...prev,
            urls: prev.urls.map((row) => (row.id === id ? { ...row, contextType } : row)),
          }))
        }
        onRemoveUrl={(id) =>
          setEditDraft((prev) => ({
            ...prev,
            urls: prev.urls.filter((row) => row.id !== id),
          }))
        }
        onRemovePhone={(id) =>
          setEditDraft((prev) => ({
            ...prev,
            phones: prev.phones.filter((row) => row.id !== id),
          }))
        }
        onRemoveEmail={(id) =>
          setEditDraft((prev) => ({
            ...prev,
            emails: prev.emails.filter((row) => row.id !== id),
          }))
        }
        onRemoveAddress={(id) =>
          setEditDraft((prev) => ({
            ...prev,
            addresses: prev.addresses.filter((row) => row.id !== id),
          }))
        }
        onAddPhone={addRow((prev, id) => ({
          ...prev,
          phones: [...prev.phones, { id, number: "", phoneType: "mobile" }],
        }))}
        onAddEmail={addRow((prev, id) => ({
          ...prev,
          emails: [
            ...prev.emails,
            { id, address: "", contextType: CONTACT_CHANNEL_DEFAULT_CONTEXT },
          ],
        }))}
        onAddAddress={addRow((prev, id) => ({
          ...prev,
          addresses: [
            ...prev.addresses,
            {
              id,
              street: "",
              locality: "",
              region: "",
              postalCode: "",
              country: "",
              contextType: CONTACT_CHANNEL_DEFAULT_CONTEXT,
            },
          ],
        }))}
        onAddUrl={addRow((prev, id) => ({
          ...prev,
          urls: [...prev.urls, { id, uri: "", contextType: CONTACT_CHANNEL_DEFAULT_CONTEXT }],
        }))}
      />
    </ContactsStoryScope>
  );
}

const meta = {
  title: "Features/Contacts/Panes/Detail",
  component: ContactsDetailPaneHarness,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof ContactsDetailPaneHarness>;

export default meta;
type Story = StoryObj<typeof ContactsDetailPaneHarness>;

const phoneTypeName = `${defaultContactsLabels.channelType} ${defaultContactsLabels.phoneNumber}`;

export const Editable: Story = {
  tags: ["vitest-ci"],
  args: {},
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const title = canvasElement.querySelector(".contacts-detail-view__title");
    await expect([...(title?.querySelectorAll("input") ?? [])].map((input) => input.id)).toEqual([
      "contact-given-name",
      "contact-surname",
    ]);
    const nameInput = canvas.getByLabelText(defaultContactsLabels.nameGiven);
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "Janet");
    await expect(nameInput).toHaveValue("Janet");

    const birthday = canvas.getByRole("button", { name: /Birthday:/ });
    await expect(birthday).toHaveClass("collection-ghost-select");
    await expect(birthday).toHaveAccessibleName(/1985/);
    await userEvent.click(birthday);
    const day = await waitFor(() => {
      const found = canvasElement.ownerDocument.querySelector<HTMLButtonElement>(
        'button[data-day]:not([data-selected-single="true"])',
      );
      expect(found).toBeTruthy();
      return found!;
    });
    await userEvent.click(day);
    await expect(canvas.getByRole("button", { name: /Birthday:/ })).not.toHaveAccessibleName(
      /Apr 23, 1985|April 23, 1985/,
    );

    // Typing never adds a row; Add phone does, and focuses it.
    const phonesBefore = canvas.getAllByRole("combobox", { name: phoneTypeName }).length;
    await userEvent.click(canvas.getByRole("button", { name: defaultContactsLabels.addPhone }));
    const phones = canvas.getAllByLabelText(defaultContactsLabels.phoneNumber);
    await expect(phones).toHaveLength(phonesBefore + 1);
    await waitFor(() => expect(phones.at(-1)).toHaveFocus());
    await userEvent.type(phones.at(-1)!, "555");
    await expect(canvas.getAllByLabelText(defaultContactsLabels.phoneNumber)).toHaveLength(
      phonesBefore + 1,
    );

    // Jane has an address and a website, so those have their own add buttons.
    await expect(
      canvas.getByRole("button", { name: defaultContactsLabels.addAddress }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: defaultContactsLabels.addUrl }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("textbox", { name: defaultContactsLabels.sectionNotes }),
    ).toHaveAttribute("placeholder", defaultContactsLabels.notesPlaceholder);
  },
};

export const Create: Story = {
  tags: ["vitest-ci"],
  args: { createMode: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByLabelText(defaultContactsLabels.nameGiven)).toHaveFocus();
    await expect(
      canvas.getByRole("button", { name: defaultContactsLabels.addPhone }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: defaultContactsLabels.addEmail }),
    ).toBeInTheDocument();
    // Addresses and websites come in through "Add field" until there is one.
    await expect(
      canvas.queryByRole("button", { name: defaultContactsLabels.addAddress }),
    ).toBeNull();
    await expect(canvas.queryByRole("button", { name: defaultContactsLabels.addUrl })).toBeNull();
    await expect(canvas.queryByLabelText(defaultContactsLabels.phoneNumber)).toBeNull();
    await expect(canvas.queryByRole("button", { name: /Birthday:/ })).toBeNull();

    await userEvent.click(canvas.getByRole("button", { name: defaultContactsLabels.addPhone }));
    const phone = canvas.getByLabelText(defaultContactsLabels.phoneNumber);
    await waitFor(() => expect(phone).toHaveFocus());
    await userEvent.type(phone, "555");
    await expect(canvas.getAllByLabelText(defaultContactsLabels.phoneNumber)).toHaveLength(1);
    await expect(canvas.getByRole("combobox", { name: phoneTypeName })).toHaveTextContent(
      defaultContactsLabels.channelTypeMobile,
    );

    await userEvent.click(canvas.getByRole("button", { name: defaultContactsLabels.addField }));
    const menu = await within(canvasElement.ownerDocument.body).findByRole("menu");
    await expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent?.trim()),
    ).toEqual([
      defaultContactsLabels.nameGiven2,
      defaultContactsLabels.jobTitle,
      defaultContactsLabels.jobDepartment,
      defaultContactsLabels.sectionBirthday,
      defaultContactsLabels.address,
      defaultContactsLabels.urlAddress,
    ]);
    await userEvent.keyboard("{Escape}");
  },
};

export const ReadOnly: Story = {
  tags: ["vitest-ci"],
  args: { readOnly: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const header = canvasElement.querySelector(".contacts-detail-view__header");
    expect(header?.querySelector(".user-avatar--xl")).toBeTruthy();
    expect(header?.querySelector(".contacts-detail-view__heading")).toBeTruthy();
    const given = canvas.getByLabelText(defaultContactsLabels.nameGiven);
    await expect(given).toHaveValue("Jane");
    await expect(given).toHaveAttribute("readonly");
    await expect(canvas.getByLabelText(defaultContactsLabels.organizationName)).toHaveValue(
      "Acme Corp",
    );
    // Type dropdowns stay as labels but cannot be opened.
    for (const select of canvas.getAllByRole("combobox")) {
      await expect(select).toBeDisabled();
    }
    const birthday = canvas.getByRole("button", { name: /Birthday:/ });
    await expect(birthday).toBeDisabled();
    await expect(birthday).toHaveAccessibleName(/1985/);
    await expect(canvas.queryByRole("button", { name: defaultContactsLabels.addField })).toBeNull();
    await expect(canvas.queryByRole("button", { name: defaultContactsLabels.addPhone })).toBeNull();
    await expect(
      canvas.queryByRole("button", { name: defaultContactsLabels.removeRow }),
    ).toBeNull();
    await expect(
      canvas.queryByRole("switch", { name: defaultContactsLabels.companyContact }),
    ).toBeNull();
  },
};
