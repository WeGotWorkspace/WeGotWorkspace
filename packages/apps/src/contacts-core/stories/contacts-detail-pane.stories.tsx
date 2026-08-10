import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { createContactsAppBootstrap } from "@/lib/api/mock/contacts-bootstrap";
import { ContactsDetailView } from "@/contacts-core/src/contacts-detail-view";
import { defaultContactsLabels } from "@/contacts-core/src/contacts-labels";
import { contactCardToEditDraft } from "@/contacts-core/src/contacts-edit-utils";
import { ContactsStoryScope } from "./contacts-story-scope";

function ContactsDetailPaneHarness({ readOnly = false }: { readOnly?: boolean }) {
  const card = createContactsAppBootstrap().data.cards[0];
  const [editMode, setEditMode] = useState(!readOnly);
  const [editDraft, setEditDraft] = useState(() => contactCardToEditDraft(card));

  return (
    <ContactsStoryScope variant="detail">
      <ContactsDetailView
        labels={defaultContactsLabels}
        card={card}
        createMode={false}
        editMode={editMode}
        editDraft={editDraft}
        displayName={card.name?.full ?? "Jane Doe"}
        onDraftChange={(patch) => setEditDraft((prev) => ({ ...prev, ...patch }))}
        onAddPhone={() =>
          setEditDraft((prev) => ({
            ...prev,
            phones: [...prev.phones, { id: "phone-new", number: "", phoneType: "" }],
          }))
        }
        onAddEmail={() =>
          setEditDraft((prev) => ({
            ...prev,
            emails: [...prev.emails, { id: "email-new", address: "", contextType: "" }],
          }))
        }
        onAddAddress={() =>
          setEditDraft((prev) => ({
            ...prev,
            addresses: [
              ...prev.addresses,
              {
                id: "address-new",
                street: "",
                locality: "",
                region: "",
                postalCode: "",
                country: "",
                contextType: "",
              },
            ],
          }))
        }
        onAddUrl={() =>
          setEditDraft((prev) => ({
            ...prev,
            urls: [...prev.urls, { id: "url-new", uri: "", contextType: "" }],
          }))
        }
        onUpdatePhone={(id, number) =>
          setEditDraft((prev) => ({
            ...prev,
            phones: prev.phones.map((row) => (row.id === id ? { ...row, number } : row)),
          }))
        }
        onUpdateEmail={(id, address) =>
          setEditDraft((prev) => ({
            ...prev,
            emails: prev.emails.map((row) => (row.id === id ? { ...row, address } : row)),
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
        onUpdateAddress={(id, field, value) =>
          setEditDraft((prev) => ({
            ...prev,
            addresses: prev.addresses.map((row) =>
              row.id === id ? { ...row, [field]: value } : row,
            ),
          }))
        }
        onUpdateAddressContext={(id, contextType) =>
          setEditDraft((prev) => ({
            ...prev,
            addresses: prev.addresses.map((row) => (row.id === id ? { ...row, contextType } : row)),
          }))
        }
        onUpdateUrl={(id, uri) =>
          setEditDraft((prev) => ({
            ...prev,
            urls: prev.urls.map((row) => (row.id === id ? { ...row, uri } : row)),
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
  },
};

export const ReadOnly: Story = {
  args: { readOnly: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Home")).toBeInTheDocument();
    expect(canvas.getAllByText("Work").length).toBeGreaterThan(0);
  },
};
