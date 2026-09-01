import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/ui/tooltip";
import {
  addressesAfterFieldChange,
  emailsAfterAddressChange,
  phonesAfterNumberChange,
  urlsAfterUriChange,
} from "./contact-channel-commit";
import { ContactsDetailView } from "./contacts-detail-view";
import { defaultContactsLabels } from "./contacts-labels";
import { emptyContactEditDraft, type ContactEditDraft } from "./contacts-edit-utils";
import type { ContactCard } from "./contacts-types";

afterEach(() => {
  cleanup();
});

function EditableDetailHarness({
  initialDraft = emptyContactEditDraft(),
}: {
  initialDraft?: ContactEditDraft;
}) {
  const [editDraft, setEditDraft] = useState(initialDraft);
  return (
    <TooltipProvider delayDuration={0}>
      <ContactsDetailView
        labels={defaultContactsLabels}
        createMode
        editMode
        editDraft={editDraft}
        displayName={defaultContactsLabels.newContact}
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
      <output data-testid="draft-phones">{String(editDraft.phones.length)}</output>
      <output data-testid="draft-emails">{String(editDraft.emails.length)}</output>
      <output data-testid="draft-addresses">{String(editDraft.addresses.length)}</output>
      <output data-testid="draft-urls">{String(editDraft.urls.length)}</output>
    </TooltipProvider>
  );
}

describe("ContactsDetailView empty trailing rows", () => {
  it("always shows one empty trailing row per channel and has no Add buttons", () => {
    render(<EditableDetailHarness />);
    expect(screen.queryByRole("button", { name: defaultContactsLabels.addPhone })).toBeNull();
    expect(screen.queryByRole("button", { name: defaultContactsLabels.addEmail })).toBeNull();
    expect(screen.queryByRole("button", { name: defaultContactsLabels.addAddress })).toBeNull();
    expect(screen.queryByRole("button", { name: defaultContactsLabels.addUrl })).toBeNull();
    expect(screen.getAllByLabelText(defaultContactsLabels.phoneNumber)).toHaveLength(1);
    expect(screen.getAllByLabelText(defaultContactsLabels.emailAddress)).toHaveLength(1);
    expect(screen.getAllByLabelText(defaultContactsLabels.urlAddress)).toHaveLength(1);
    expect(screen.getByLabelText(defaultContactsLabels.addressStreet)).toBeTruthy();
    expect(screen.getByTestId("draft-phones").textContent).toBe("0");
    expect(screen.getByTestId("draft-emails").textContent).toBe("0");
    expect(screen.getByTestId("draft-addresses").textContent).toBe("0");
    expect(screen.getByTestId("draft-urls").textContent).toBe("0");
    expect(screen.queryByRole("button", { name: defaultContactsLabels.removeRow })).toBeNull();
    expect(document.querySelectorAll(".contacts-detail-view__channel-action-spacer").length).toBe(
      4,
    );
    expect(document.querySelectorAll(".contacts-detail-view__channel-action")).toHaveLength(4);
  });

  it("defaults trailing empty channel types to Home", () => {
    render(<EditableDetailHarness />);
    expect(
      screen.getByRole("combobox", {
        name: `${defaultContactsLabels.channelType} ${defaultContactsLabels.phoneNumber}`,
      }).textContent,
    ).toBe(defaultContactsLabels.channelTypeHome);
    expect(
      screen.getByRole("combobox", {
        name: `${defaultContactsLabels.channelType} ${defaultContactsLabels.emailAddress}`,
      }).textContent,
    ).toBe(defaultContactsLabels.channelTypeHome);
    expect(
      screen.getByRole("combobox", {
        name: `${defaultContactsLabels.channelType} ${defaultContactsLabels.urlAddress}`,
      }).textContent,
    ).toBe(defaultContactsLabels.channelTypeHome);
    expect(
      screen.getByRole("combobox", {
        name: `${defaultContactsLabels.channelType} ${defaultContactsLabels.sectionAddresses}`,
      }).textContent,
    ).toBe(defaultContactsLabels.channelTypeHome);
  });

  it("commits a phone on type and keeps another empty trailing row", () => {
    render(<EditableDetailHarness />);
    const phone = screen.getByLabelText(defaultContactsLabels.phoneNumber);
    fireEvent.change(phone, { target: { value: "555" } });
    expect((phone as HTMLInputElement).value).toBe("555");
    expect(screen.getAllByLabelText(defaultContactsLabels.phoneNumber)).toHaveLength(2);
    expect(screen.getByTestId("draft-phones").textContent).toBe("1");
    expect(
      (screen.getAllByLabelText(defaultContactsLabels.phoneNumber)[1] as HTMLInputElement).value,
    ).toBe("");
    expect(screen.getByRole("button", { name: defaultContactsLabels.removeRow })).toBeTruthy();
    expect(document.querySelectorAll(".contacts-detail-view__channel-action-spacer").length).toBe(
      4,
    );
    expect(document.querySelectorAll(".contacts-detail-view__channel-action")).toHaveLength(5);
    const phoneTypes = screen.getAllByRole("combobox", {
      name: `${defaultContactsLabels.channelType} ${defaultContactsLabels.phoneNumber}`,
    });
    expect(phoneTypes.map((control) => control.textContent)).toEqual([
      defaultContactsLabels.channelTypeHome,
      defaultContactsLabels.channelTypeHome,
    ]);
  });

  it("commits email, url, and address the same way", () => {
    render(<EditableDetailHarness />);
    fireEvent.change(screen.getByLabelText(defaultContactsLabels.emailAddress), {
      target: { value: "a@b.com" },
    });
    fireEvent.change(screen.getByLabelText(defaultContactsLabels.urlAddress), {
      target: { value: "https://ex.test" },
    });
    fireEvent.change(screen.getByLabelText(defaultContactsLabels.addressStreet), {
      target: { value: "1 Main" },
    });
    expect(screen.getByTestId("draft-emails").textContent).toBe("1");
    expect(screen.getByTestId("draft-urls").textContent).toBe("1");
    expect(screen.getByTestId("draft-addresses").textContent).toBe("1");
    expect(screen.getAllByLabelText(defaultContactsLabels.emailAddress)).toHaveLength(2);
    expect(screen.getAllByLabelText(defaultContactsLabels.urlAddress)).toHaveLength(2);
    expect(screen.getAllByLabelText(defaultContactsLabels.addressStreet)).toHaveLength(2);
  });

  it("keeps street on the address top row and secondary fields below", () => {
    render(<EditableDetailHarness />);
    const street = screen.getByLabelText(defaultContactsLabels.addressStreet);
    const postal = screen.getByLabelText(defaultContactsLabels.addressPostalCode);
    const city = screen.getByLabelText(defaultContactsLabels.addressLocality);
    expect(street.closest(".contacts-detail-view__channel-row--address")).toBeTruthy();
    expect(street.closest(".contacts-detail-view__address-fields")).toBeNull();
    expect(postal.closest(".contacts-detail-view__address-fields")).toBeTruthy();
    expect(postal.closest(".contacts-detail-view__channel-row--address")).toBeNull();
    expect(postal.closest(".contacts-detail-view__address-locality-row")).toBeTruthy();
    expect(city.closest(".contacts-detail-view__address-locality-row")).toBeTruthy();
  });
});

const noop = () => undefined;

const viewModeHandlers = {
  onDraftChange: noop,
  onUpdatePhone: noop,
  onUpdateEmail: noop,
  onUpdatePhoneContext: noop,
  onUpdateEmailContext: noop,
  onUpdateAddress: noop,
  onUpdateAddressContext: noop,
  onUpdateUrl: noop,
  onUpdateUrlContext: noop,
  onRemoveUrl: noop,
  onRemovePhone: noop,
  onRemoveEmail: noop,
  onRemoveAddress: noop,
};

const personWithIdentity = {
  "@type": "Card",
  version: "1.0",
  id: "card-ada",
  uid: "urn:uuid:ada",
  kind: "individual",
  name: { full: "Ada Lovelace" },
  titles: {
    "title-1": { "@type": "Title", kind: "title", name: "Mathematician" },
  },
  organizations: {
    "org-1": { "@type": "Organization", name: "Analytical Engine" },
  },
} as unknown as ContactCard;

const groupCard = {
  "@type": "Card",
  version: "1.0",
  id: "card-group-friends",
  uid: "urn:uuid:group-friends",
  kind: "group",
  name: { full: "Friends" },
  titles: {
    "title-1": { "@type": "Title", kind: "title", name: "Should not show" },
  },
  organizations: {
    "org-1": { "@type": "Organization", name: "Should not show" },
  },
} as unknown as ContactCard;

describe("ContactsDetailView identity header", () => {
  it("places name, job title, and company beside an xl avatar", () => {
    const { container } = render(
      <ContactsDetailView
        labels={defaultContactsLabels}
        card={personWithIdentity}
        createMode={false}
        editMode={false}
        editDraft={null}
        displayName="Ada Lovelace"
        {...viewModeHandlers}
      />,
    );
    const identity = container.querySelector(".contacts-detail-view__identity");
    expect(identity).toBeTruthy();
    expect(identity?.querySelector(".user-avatar--xl")).toBeTruthy();
    expect(identity?.querySelector(".contacts-detail-view__heading")).toBeTruthy();
    expect(identity?.querySelector(".contacts-detail-view__title")?.textContent).toBe(
      "Ada Lovelace",
    );
    const lines = [...(identity?.querySelectorAll(".contacts-detail-view__subtitle") ?? [])].map(
      (node) => node.textContent,
    );
    expect(lines).toEqual(["Mathematician", "Analytical Engine"]);
  });

  it("keeps Notes-like group tags below the avatar identity row", () => {
    const { container } = render(
      <TooltipProvider delayDuration={0}>
        <ContactsDetailView
          labels={defaultContactsLabels}
          card={personWithIdentity}
          createMode={false}
          editMode={false}
          editDraft={null}
          displayName="Ada Lovelace"
          groupTags={{
            assigned: [
              {
                group: groupCard,
                writable: true,
              },
            ],
            suggestions: [],
            readonly: false,
            allowCreate: false,
            onAdd: noop,
            onRemove: noop,
          }}
          {...viewModeHandlers}
        />
      </TooltipProvider>,
    );
    const identity = container.querySelector(".contacts-detail-view__identity");
    const tags = container.querySelector(".contacts-detail-view__tag-group");
    expect(identity).toBeTruthy();
    expect(tags).toBeTruthy();
    expect(identity?.contains(tags)).toBe(false);
    expect(identity?.querySelector(".contacts-detail-view__title")).toBeTruthy();
    expect(identity?.nextElementSibling).toBe(tags);
  });

  it("shows a group icon and name without job title or company", () => {
    const { container } = render(
      <ContactsDetailView
        labels={defaultContactsLabels}
        card={groupCard}
        createMode={false}
        editMode={false}
        editDraft={null}
        displayName="Friends"
        {...viewModeHandlers}
      />,
    );
    const identity = container.querySelector(".contacts-detail-view__identity");
    expect(identity?.querySelector(".contacts-group-icon-slot--xl")).toBeTruthy();
    expect(identity?.querySelector(".contacts-group-icon")).toBeTruthy();
    expect(identity?.querySelector(".user-avatar")).toBeNull();
    expect(identity?.querySelector(".contacts-detail-view__title")?.textContent).toBe("Friends");
    expect(identity?.querySelector(".contacts-detail-view__subtitle")).toBeNull();
  });

  it("shows a company icon instead of initials for org cards", () => {
    const orgCard = {
      "@type": "Card",
      version: "1.0",
      id: "card-acme",
      uid: "urn:uuid:acme",
      kind: "org",
      organizations: {
        "org-1": { "@type": "Organization", name: "Acme Corp" },
      },
    } as unknown as ContactCard;
    const { container } = render(
      <ContactsDetailView
        labels={defaultContactsLabels}
        card={orgCard}
        createMode={false}
        editMode={false}
        editDraft={null}
        displayName="Acme Corp"
        {...viewModeHandlers}
      />,
    );
    const identity = container.querySelector(".contacts-detail-view__identity");
    expect(
      identity?.querySelector(".contacts-detail-view__avatar .contacts-org-icon"),
    ).toBeTruthy();
    expect(identity?.querySelector(".contacts-group-icon")).toBeNull();
    expect(identity?.querySelector(".user-avatar__mark")?.textContent).not.toMatch(/A/);
    expect(identity?.querySelector(".contacts-detail-view__title")?.textContent).toBe("Acme Corp");
  });
});

const familyGroup = {
  "@type": "Card",
  version: "1.0",
  id: "card-group-family",
  uid: "urn:uuid:family",
  kind: "group",
  addressBookIds: { default: true },
  name: { full: "Family" },
} as unknown as ContactCard;

describe("ContactsDetailView group tags", () => {
  it("adds and removes group membership through the shared TagGroup", () => {
    const onAdd = vi.fn();
    const onRemove = vi.fn();
    render(
      <TooltipProvider delayDuration={0}>
        <ContactsDetailView
          labels={defaultContactsLabels}
          card={personWithIdentity}
          createMode={false}
          editMode={false}
          editDraft={null}
          displayName="Ada Lovelace"
          groupTags={{
            assigned: [{ group: groupCard, writable: true }],
            suggestions: [familyGroup],
            readonly: false,
            allowCreate: true,
            onAdd,
            onRemove,
          }}
          {...viewModeHandlers}
        />
      </TooltipProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove group Friends" }));
    expect(onRemove).toHaveBeenCalledWith("card-group-friends");

    fireEvent.click(screen.getByRole("button", { name: defaultContactsLabels.addGroup }));
    fireEvent.change(screen.getByRole("combobox", { name: defaultContactsLabels.addGroup }), {
      target: { value: "Fam" },
    });
    fireEvent.mouseDown(screen.getByRole("option", { name: "Family" }));
    expect(onAdd).toHaveBeenCalledWith("card-group-family");
  });

  it("shows read-only chips for a view-only sharee", () => {
    render(
      <TooltipProvider delayDuration={0}>
        <ContactsDetailView
          labels={defaultContactsLabels}
          card={personWithIdentity}
          createMode={false}
          editMode={false}
          editDraft={null}
          displayName="Ada Lovelace"
          groupTags={{
            assigned: [{ group: groupCard, writable: false }],
            suggestions: [familyGroup],
            readonly: true,
            allowCreate: false,
            onAdd: vi.fn(),
            onRemove: vi.fn(),
          }}
          {...viewModeHandlers}
        />
      </TooltipProvider>,
    );

    expect(screen.getByText("Friends")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove group Friends" })).toBeNull();
    expect(screen.queryByRole("button", { name: defaultContactsLabels.addGroup })).toBeNull();
  });

  it("does not render the tag group when groupTags is omitted (group cards)", () => {
    const { container } = render(
      <ContactsDetailView
        labels={defaultContactsLabels}
        card={groupCard}
        createMode={false}
        editMode={false}
        editDraft={null}
        displayName="Friends"
        {...viewModeHandlers}
      />,
    );

    expect(container.querySelector(".contacts-detail-view__tag-group")).toBeNull();
    expect(container.querySelector(".tag-group")).toBeNull();
  });
});
