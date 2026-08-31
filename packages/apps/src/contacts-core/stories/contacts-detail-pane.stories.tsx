import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
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
  contactCardToEditDraft,
  emptyContactEditDraft,
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
  const [editMode, setEditMode] = useState(!readOnly);
  const [editDraft, setEditDraft] = useState(() =>
    createMode || !card ? emptyContactEditDraft() : contactCardToEditDraft(card),
  );

  return (
    <ContactsStoryScope variant="detail">
      <ContactsDetailView
        labels={defaultContactsLabels}
        card={card}
        createMode={createMode}
        editMode={editMode}
        editDraft={editDraft}
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
      />
      {readOnly ? null : (
        <button type="button" className="sr-only" onClick={() => setEditMode((value) => !value)}>
          Toggle edit
        </button>
      )}
    </ContactsStoryScope>
  );
}

const meta = {
  title: "Apps/Contacts/Panes/Detail",
  component: ContactsDetailPaneHarness,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof ContactsDetailPaneHarness>;

export default meta;
type Story = StoryObj<typeof ContactsDetailPaneHarness>;

export const Editable: Story = {
  tags: ["vitest-ci"],
  args: {},
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const nameInput = canvas.getByLabelText("First name");
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "Jane Updated");
    await expect(nameInput).toHaveValue("Jane Updated");
    await expect(
      canvas.getAllByRole("combobox", {
        name: `${defaultContactsLabels.channelType} ${defaultContactsLabels.phoneNumber}`,
      }).length,
    ).toBeGreaterThanOrEqual(2);
    await expect(canvas.queryByRole("button", { name: defaultContactsLabels.addPhone })).toBeNull();
  },
};

export const Create: Story = {
  tags: ["vitest-ci"],
  args: { createMode: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: defaultContactsLabels.newContact }),
    ).toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: defaultContactsLabels.addPhone })).toBeNull();
    await expect(canvas.queryByRole("button", { name: defaultContactsLabels.addEmail })).toBeNull();
    await expect(
      canvas.queryByRole("button", { name: defaultContactsLabels.addAddress }),
    ).toBeNull();
    await expect(canvas.queryByRole("button", { name: defaultContactsLabels.addUrl })).toBeNull();
    const phone = canvas.getByLabelText(defaultContactsLabels.phoneNumber);
    await userEvent.type(phone, "555");
    await expect(phone).toHaveValue("555");
    await expect(canvas.getAllByLabelText(defaultContactsLabels.phoneNumber)).toHaveLength(2);
    await expect(
      canvas.getAllByRole("combobox", {
        name: `${defaultContactsLabels.channelType} ${defaultContactsLabels.phoneNumber}`,
      }),
    ).toHaveLength(2);
  },
};

export const ReadOnly: Story = {
  tags: ["vitest-ci"],
  args: { readOnly: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Home")).toBeInTheDocument();
    expect(canvas.getAllByText("Work").length).toBeGreaterThan(0);
    expect(canvas.queryByRole("combobox")).toBeNull();
    const identity = canvasElement.querySelector(".contacts-detail-view__identity");
    expect(identity?.querySelector(".user-avatar--xl")).toBeTruthy();
    expect(identity?.querySelector(".contacts-detail-view__heading")).toBeTruthy();
    await expect(canvas.getByRole("heading", { name: "Jane Doe" })).toBeInTheDocument();
    await expect(canvas.getByText("Acme Corp")).toBeInTheDocument();
    expect(identity?.contains(canvas.getByRole("heading", { name: "Jane Doe" }))).toBe(true);
    expect(identity?.contains(canvas.getByText("Acme Corp"))).toBe(true);
  },
};
