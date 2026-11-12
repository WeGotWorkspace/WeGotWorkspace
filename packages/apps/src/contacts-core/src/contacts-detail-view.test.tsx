import { useState, type ComponentProps } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/ui/tooltip";
import {
  addressesAfterFieldChange,
  emailsAfterAddressChange,
  phonesAfterNumberChange,
  urlsAfterUriChange,
} from "./contact-channel-commit";
import { ContactsDetailView } from "./contacts-detail-view";
import { addressBookDotColor } from "./contacts-addressbook-color";
import { defaultContactsLabels as L } from "./contacts-labels";
import { CONTACT_CHANNEL_DEFAULT_CONTEXT, emptyContactEditDraft } from "./contacts-edit-utils";
import { contactCardToEditDraft, type ContactEditDraft } from "@/lib/models/contacts-edit-draft";
import type { ContactCard } from "@/lib/models/contacts-types";

beforeAll(() => {
  // Radix menus and popovers measure and scroll; jsdom has none of it.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
});

afterEach(() => {
  cleanup();
});

type ViewProps = ComponentProps<typeof ContactsDetailView>;

const noop = () => undefined;

/** Every handler a no-op: for sheets that only show a card. */
const displayHandlers = {
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
  onAddPhone: noop,
  onAddEmail: noop,
  onAddAddress: noop,
  onAddUrl: noop,
} satisfies Partial<ViewProps>;

let rowCounter = 0;
const nextRowId = () => `row-${++rowCounter}`;

/**
 * The sheet wired to a local draft the way the controller wires it: updates go
 * through the channel commit helpers, and each "Add …" appends an empty row and
 * returns its id.
 */
function EditableDetailHarness({
  initialDraft = emptyContactEditDraft(),
  card,
  createMode = !card,
  spies = {},
  extra = {},
}: {
  initialDraft?: ContactEditDraft;
  card?: ContactCard;
  createMode?: boolean;
  spies?: Partial<Record<"onAddPhone" | "onAddEmail" | "onAddAddress" | "onAddUrl", () => void>>;
  extra?: Partial<ViewProps>;
}) {
  const [draft, setDraft] = useState(initialDraft);
  const add =
    (key: keyof typeof spies, patch: (prev: ContactEditDraft, id: string) => ContactEditDraft) =>
    () => {
      spies[key]?.();
      const id = nextRowId();
      setDraft((prev) => patch(prev, id));
      return id;
    };
  return (
    <TooltipProvider delayDuration={0}>
      <ContactsDetailView
        labels={L}
        card={card}
        createMode={createMode}
        readOnly={false}
        editDraft={draft}
        displayName={L.newContact}
        onDraftChange={(patch) => setDraft((prev) => ({ ...prev, ...patch }))}
        onUpdatePhone={(id, number, phoneType) =>
          setDraft((prev) => ({
            ...prev,
            phones: phonesAfterNumberChange({ phones: prev.phones, rowId: id, number, phoneType }),
          }))
        }
        onUpdateEmail={(id, address, contextType) =>
          setDraft((prev) => ({
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
          setDraft((prev) => ({
            ...prev,
            phones: prev.phones.map((row) => (row.id === id ? { ...row, phoneType } : row)),
          }))
        }
        onUpdateEmailContext={(id, contextType) =>
          setDraft((prev) => ({
            ...prev,
            emails: prev.emails.map((row) => (row.id === id ? { ...row, contextType } : row)),
          }))
        }
        onUpdateAddress={(id, field, value, contextType) =>
          setDraft((prev) => ({
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
          setDraft((prev) => ({
            ...prev,
            addresses: prev.addresses.map((row) => (row.id === id ? { ...row, contextType } : row)),
          }))
        }
        onUpdateUrl={(id, uri, contextType) =>
          setDraft((prev) => ({
            ...prev,
            urls: urlsAfterUriChange({ urls: prev.urls, rowId: id, uri, contextType }),
          }))
        }
        onUpdateUrlContext={(id, contextType) =>
          setDraft((prev) => ({
            ...prev,
            urls: prev.urls.map((row) => (row.id === id ? { ...row, contextType } : row)),
          }))
        }
        onRemoveUrl={(id) =>
          setDraft((prev) => ({ ...prev, urls: prev.urls.filter((row) => row.id !== id) }))
        }
        onRemovePhone={(id) =>
          setDraft((prev) => ({ ...prev, phones: prev.phones.filter((row) => row.id !== id) }))
        }
        onRemoveEmail={(id) =>
          setDraft((prev) => ({ ...prev, emails: prev.emails.filter((row) => row.id !== id) }))
        }
        onRemoveAddress={(id) =>
          setDraft((prev) => ({
            ...prev,
            addresses: prev.addresses.filter((row) => row.id !== id),
          }))
        }
        onAddPhone={add("onAddPhone", (prev, id) => ({
          ...prev,
          phones: [...prev.phones, { id, number: "", phoneType: "mobile" }],
        }))}
        onAddEmail={add("onAddEmail", (prev, id) => ({
          ...prev,
          emails: [
            ...prev.emails,
            { id, address: "", contextType: CONTACT_CHANNEL_DEFAULT_CONTEXT },
          ],
        }))}
        onAddAddress={add("onAddAddress", (prev, id) => ({
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
        onAddUrl={add("onAddUrl", (prev, id) => ({
          ...prev,
          urls: [...prev.urls, { id, uri: "", contextType: CONTACT_CHANNEL_DEFAULT_CONTEXT }],
        }))}
        {...extra}
      />
      <output data-testid="draft">{JSON.stringify(draft)}</output>
    </TooltipProvider>
  );
}

function currentDraft(): ContactEditDraft {
  return JSON.parse(screen.getByTestId("draft").textContent ?? "{}") as ContactEditDraft;
}

function openAddFieldMenu() {
  fireEvent.keyDown(screen.getByRole("button", { name: L.addField }), { key: "Enter" });
  return screen.getByRole("menu");
}

function addFieldMenuLabels(): string[] {
  const menu = openAddFieldMenu();
  const labels = within(menu)
    .getAllByRole("menuitem")
    .map((item) => item.textContent?.trim() ?? "");
  fireEvent.keyDown(menu, { key: "Escape" });
  return labels;
}

function titleInputIds(): string[] {
  const title = document.querySelector(".contacts-detail-view__title");
  return [...(title?.querySelectorAll("input") ?? [])].map((input) => input.id);
}

const personWithIdentity = {
  "@type": "Card",
  version: "1.0",
  id: "card-ada",
  uid: "urn:uuid:ada",
  kind: "individual",
  name: { full: "Ada Lovelace" },
  addressBookIds: { default: true },
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
  addressBookIds: { default: true },
  titles: {
    "title-1": { "@type": "Title", kind: "title", name: "Should not show" },
  },
  organizations: {
    "org-1": { "@type": "Organization", name: "Should not show" },
  },
} as unknown as ContactCard;

const familyGroup = {
  "@type": "Card",
  version: "1.0",
  id: "card-group-family",
  uid: "urn:uuid:family",
  kind: "group",
  addressBookIds: { default: true },
  name: { full: "Family" },
} as unknown as ContactCard;

const janeWithBirthday = {
  "@type": "Card",
  version: "1.0",
  id: "card-jane-bday",
  uid: "urn:uuid:jane-bday",
  kind: "individual",
  name: { full: "Jane Doe" },
  addressBookIds: { default: true },
  anniversaries: {
    "bday-1": {
      "@type": "Anniversary",
      kind: "birth",
      date: { "@type": "PartialDate", year: 1985, month: 4, day: 23 },
    },
  },
} as unknown as ContactCard;

function renderReadOnly(props: Partial<ViewProps> & { card?: ContactCard }) {
  return render(
    <TooltipProvider delayDuration={0}>
      <ContactsDetailView
        labels={L}
        createMode={false}
        readOnly
        editDraft={null}
        displayName="Ada Lovelace"
        {...displayHandlers}
        {...props}
      />
    </TooltipProvider>,
  );
}

describe("ContactsDetailView editable sheet", () => {
  it("shows first and last name as title inputs, with no middle name until it is added", () => {
    render(<EditableDetailHarness />);
    expect(titleInputIds()).toEqual(["contact-given-name", "contact-surname"]);
    const given = screen.getByRole("textbox", { name: L.nameGiven }) as HTMLInputElement;
    expect(given.readOnly).toBe(false);
    expect(document.activeElement).toBe(given);
    fireEvent.change(given, { target: { value: "Grace" } });
    fireEvent.change(screen.getByRole("textbox", { name: L.nameSurname }), {
      target: { value: "Hopper" },
    });
    expect(currentDraft()).toMatchObject({ nameGiven: "Grace", nameSurname: "Hopper" });
  });

  it("puts the middle name between first and last name once it is added from Add field", () => {
    render(<EditableDetailHarness />);
    fireEvent.click(within(openAddFieldMenu()).getByRole("menuitem", { name: L.nameGiven2 }));
    expect(titleInputIds()).toEqual([
      "contact-given-name",
      "contact-field-middleName",
      "contact-surname",
    ]);
    expect(currentDraft().showGiven2).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: L.nameGiven2 }), {
      target: { value: "Brewster" },
    });
    expect(currentDraft().nameGiven2).toBe("Brewster");
    expect(addFieldMenuLabels()).not.toContain(L.nameGiven2);
  });

  it("shows a middle name that already has a value without Add field", () => {
    render(
      <EditableDetailHarness
        initialDraft={{
          ...emptyContactEditDraft(),
          nameGiven: "Grace",
          nameGiven2: "Brewster",
          nameSurname: "Hopper",
        }}
      />,
    );
    expect(titleInputIds()).toEqual([
      "contact-given-name",
      "contact-field-middleName",
      "contact-surname",
    ]);
  });

  it("starts with Add phone and Add email but no phone, e-mail, address or website rows", () => {
    render(<EditableDetailHarness />);
    expect(screen.getByRole("button", { name: L.addPhone })).toBeTruthy();
    expect(screen.getByRole("button", { name: L.addEmail })).toBeTruthy();
    // Addresses and websites come in through "Add field" until there is one.
    expect(screen.queryByRole("button", { name: L.addAddress })).toBeNull();
    expect(screen.queryByRole("button", { name: L.addUrl })).toBeNull();
    expect(screen.queryAllByLabelText(L.phoneNumber)).toHaveLength(0);
    expect(screen.queryAllByLabelText(L.emailAddress)).toHaveLength(0);
    expect(screen.queryByLabelText(L.addressStreet)).toBeNull();
    expect(screen.queryByLabelText(L.urlAddress)).toBeNull();
  });

  it("adds a phone row with Add phone, focuses it, and typing does not add another row", () => {
    const onAddPhone = vi.fn();
    render(<EditableDetailHarness spies={{ onAddPhone }} />);
    fireEvent.click(screen.getByRole("button", { name: L.addPhone }));
    expect(onAddPhone).toHaveBeenCalledOnce();

    const phone = screen.getByLabelText(L.phoneNumber) as HTMLInputElement;
    expect(document.activeElement).toBe(phone);
    expect(
      screen.getByRole("combobox", { name: `${L.channelType} ${L.phoneNumber}` }).textContent,
    ).toBe(L.channelTypeMobile);

    fireEvent.change(phone, { target: { value: "5550123" } });
    expect(screen.getAllByLabelText(L.phoneNumber)).toHaveLength(1);
    expect((screen.getByLabelText(L.phoneNumber) as HTMLInputElement).value).toBe("5550123");
    expect(currentDraft().phones).toHaveLength(1);
    expect(screen.getByRole("button", { name: L.callPhone })).toBeTruthy();
  });

  it("adds and removes an e-mail row", () => {
    const onAddEmail = vi.fn();
    render(<EditableDetailHarness spies={{ onAddEmail }} />);
    fireEvent.click(screen.getByRole("button", { name: L.addEmail }));
    expect(onAddEmail).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByLabelText(L.emailAddress), { target: { value: "a@b.test" } });
    expect(currentDraft().emails.map((row) => row.address)).toEqual(["a@b.test"]);

    fireEvent.click(screen.getByRole("button", { name: L.removeRow }));
    expect(screen.queryByLabelText(L.emailAddress)).toBeNull();
    expect(currentDraft().emails).toHaveLength(0);
  });

  it("lists only the hidden fields under Add field", () => {
    render(<EditableDetailHarness />);
    expect(addFieldMenuLabels()).toEqual([
      L.nameGiven2,
      L.jobTitle,
      L.jobDepartment,
      L.sectionBirthday,
      L.address,
      L.urlAddress,
    ]);
  });

  it("drops fields with a value from Add field", () => {
    render(
      <EditableDetailHarness
        card={personWithIdentity}
        initialDraft={contactCardToEditDraft(personWithIdentity)}
      />,
    );
    // Ada has a job title, so the row is shown and the menu leaves it out.
    expect((screen.getByRole("textbox", { name: L.jobTitle }) as HTMLInputElement).value).toBe(
      "Mathematician",
    );
    expect(addFieldMenuLabels()).toEqual([
      L.nameGiven2,
      L.jobDepartment,
      L.sectionBirthday,
      L.address,
      L.urlAddress,
    ]);
  });

  it("adds an address from Add field, then offers Add address instead", () => {
    const onAddAddress = vi.fn();
    render(<EditableDetailHarness spies={{ onAddAddress }} />);
    fireEvent.click(within(openAddFieldMenu()).getByRole("menuitem", { name: L.address }));
    expect(onAddAddress).toHaveBeenCalledOnce();
    expect(screen.getByLabelText(L.addressStreet)).toBeTruthy();
    expect(screen.getByRole("button", { name: L.addAddress })).toBeTruthy();
    expect(addFieldMenuLabels()).not.toContain(L.address);

    fireEvent.click(screen.getByRole("button", { name: L.addAddress }));
    expect(onAddAddress).toHaveBeenCalledTimes(2);
    expect(screen.getAllByLabelText(L.addressStreet)).toHaveLength(2);
  });

  it("adds a website from Add field, then offers Add website instead", () => {
    const onAddUrl = vi.fn();
    render(<EditableDetailHarness spies={{ onAddUrl }} />);
    fireEvent.click(within(openAddFieldMenu()).getByRole("menuitem", { name: L.urlAddress }));
    expect(onAddUrl).toHaveBeenCalledOnce();
    expect(screen.getByLabelText(L.urlAddress)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: L.addUrl }));
    expect(onAddUrl).toHaveBeenCalledTimes(2);
    expect(screen.getAllByLabelText(L.urlAddress)).toHaveLength(2);
  });

  it("lays out an address as street, then postal code and city on one line", () => {
    render(<EditableDetailHarness />);
    fireEvent.click(within(openAddFieldMenu()).getByRole("menuitem", { name: L.address }));
    const street = screen.getByLabelText(L.addressStreet);
    const postal = screen.getByLabelText(L.addressPostalCode);
    const city = screen.getByLabelText(L.addressLocality);
    expect(street.closest(".contacts-detail-view__address-line")).toBeNull();
    expect(postal.closest(".contacts-detail-view__address-line")).toBe(
      city.closest(".contacts-detail-view__address-line"),
    );
    fireEvent.change(city, { target: { value: "Utrecht" } });
    expect(currentDraft().addresses[0]?.locality).toBe("Utrecht");
  });

  it("reveals the birthday from Add field and writes the picked date", () => {
    render(<EditableDetailHarness />);
    expect(screen.queryByRole("button", { name: /^Birthday:/ })).toBeNull();
    fireEvent.click(within(openAddFieldMenu()).getByRole("menuitem", { name: L.sectionBirthday }));
    const field = screen.getByRole("button", { name: /^Birthday:/ });
    expect(field.className).toContain("collection-ghost-select");
    fireEvent.click(field);
    const day = document.querySelector<HTMLButtonElement>("button[data-day]");
    expect(day).toBeTruthy();
    fireEvent.click(day!);
    expect(currentDraft().birthday).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("edits an existing birthday with the ghost date picker", () => {
    render(
      <EditableDetailHarness
        card={janeWithBirthday}
        initialDraft={contactCardToEditDraft(janeWithBirthday)}
      />,
    );
    const field = screen.getByRole("button", { name: /^Birthday:/ });
    expect(field.getAttribute("aria-label")).toMatch(/1985/);
    expect(currentDraft().birthday).toBe("1985-04-23");
    fireEvent.click(field);
    const day = document.querySelector<HTMLButtonElement>(
      'button[data-day]:not([data-selected-single="true"])',
    );
    expect(day).toBeTruthy();
    fireEvent.click(day!);
    expect(currentDraft().birthday).not.toBe("1985-04-23");
    expect(currentDraft().birthday).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("switches a person to a company with the Company contact switch", () => {
    render(<EditableDetailHarness />);
    fireEvent.click(screen.getByRole("switch", { name: L.companyContact }));
    expect(currentDraft().showAsCompany).toBe(true);
    expect(titleInputIds()).toEqual(["contact-organization"]);
  });

  it("puts the notes in the last field row", () => {
    const { container } = render(<EditableDetailHarness />);
    const notes = screen.getByRole("textbox", { name: L.sectionNotes });
    expect(notes.getAttribute("placeholder")).toBe(L.notesPlaceholder);
    const lists = container.querySelectorAll(".detail-field-list");
    expect(lists[lists.length - 1]?.contains(notes)).toBe(true);
    fireEvent.change(notes, { target: { value: "Met at the conference" } });
    expect(currentDraft().notes).toBe("Met at the conference");
  });
});

describe("ContactsDetailView company contacts", () => {
  const companyDraft: ContactEditDraft = {
    ...emptyContactEditDraft(),
    showAsCompany: true,
    organization: "Acme Corp",
    nameGiven: "Wile",
    nameSurname: "Coyote",
    title: "Should not show",
  };

  it("shows the organization as the title and the person's name in a Name row", () => {
    render(<EditableDetailHarness initialDraft={companyDraft} />);
    expect(titleInputIds()).toEqual(["contact-organization"]);
    const organization = screen.getByRole("textbox", { name: L.companyName }) as HTMLInputElement;
    expect(organization.value).toBe("Acme Corp");
    expect(organization.getAttribute("placeholder")).toBe(L.companyName);

    const nameRow = screen.getByText(L.sectionName).closest(".detail-field-row");
    expect(nameRow).toBeTruthy();
    const nameInputs = [...(nameRow?.querySelectorAll("input") ?? [])].map((input) => input.id);
    expect(nameInputs).toEqual(["contact-given-name", "contact-surname"]);
    expect((screen.getByRole("textbox", { name: L.nameGiven }) as HTMLInputElement).value).toBe(
      "Wile",
    );
  });

  it("hides Job title for companies, even from Add field", () => {
    render(<EditableDetailHarness initialDraft={companyDraft} />);
    expect(screen.queryByRole("textbox", { name: L.jobTitle })).toBeNull();
    const labels = addFieldMenuLabels();
    expect(labels).not.toContain(L.jobTitle);
    expect(labels).toContain(L.nameGiven2);
    expect(labels).toContain(L.jobDepartment);
  });

  it("puts an added middle name between first and last name in the Name row", () => {
    render(<EditableDetailHarness initialDraft={companyDraft} />);
    fireEvent.click(within(openAddFieldMenu()).getByRole("menuitem", { name: L.nameGiven2 }));
    const nameRow = screen.getByText(L.sectionName).closest(".detail-field-row");
    expect([...(nameRow?.querySelectorAll("input") ?? [])].map((input) => input.id)).toEqual([
      "contact-given-name",
      "contact-field-middleName",
      "contact-surname",
    ]);
  });
});

describe("ContactsDetailView read-only", () => {
  it("shows filled rows only and no add, remove or Add field controls", () => {
    const draft: ContactEditDraft = {
      ...emptyContactEditDraft(),
      nameGiven: "Ada",
      phones: [
        { id: "p1", number: "555 0100", phoneType: "work" },
        { id: "p2", number: "", phoneType: "mobile" },
      ],
      emails: [{ id: "e1", address: "", contextType: "home" }],
    };
    renderReadOnly({ card: personWithIdentity, editDraft: draft });

    const phones = screen.getAllByLabelText(L.phoneNumber) as HTMLInputElement[];
    expect(phones).toHaveLength(1);
    expect(phones[0]?.readOnly).toBe(true);
    expect(phones[0]?.value).toBe("555 0100");
    const phoneType = screen.getByRole("combobox", {
      name: `${L.channelType} ${L.phoneNumber}`,
    }) as HTMLButtonElement;
    expect(phoneType.disabled).toBe(true);
    // Calling still works on a card you cannot change.
    expect(screen.getByRole("button", { name: L.callPhone })).toBeTruthy();

    expect(screen.queryByLabelText(L.emailAddress)).toBeNull();
    expect(screen.queryByRole("button", { name: L.addPhone })).toBeNull();
    expect(screen.queryByRole("button", { name: L.addEmail })).toBeNull();
    expect(screen.queryByRole("button", { name: L.addField })).toBeNull();
    expect(screen.queryByRole("button", { name: L.removeRow })).toBeNull();
    expect(screen.queryByRole("switch", { name: L.companyContact })).toBeNull();
    expect(screen.queryByRole("textbox", { name: L.sectionNotes })).toBeNull();
    // An empty last name is left out of the title instead of showing its placeholder.
    expect(titleInputIds()).toEqual(["contact-given-name"]);
    expect((screen.getByRole("textbox", { name: L.nameGiven }) as HTMLInputElement).readOnly).toBe(
      true,
    );
  });

  it("shows the card's own values read-only before the editing draft exists", () => {
    renderReadOnly({ card: personWithIdentity, readOnly: false, editDraft: null });
    const given = screen.getByRole("textbox", { name: L.nameGiven }) as HTMLInputElement;
    expect(given.value).toBe("Ada");
    expect(given.readOnly).toBe(true);
    expect((screen.getByRole("textbox", { name: L.nameSurname }) as HTMLInputElement).value).toBe(
      "Lovelace",
    );
    expect(
      (screen.getByRole("textbox", { name: L.organizationName }) as HTMLInputElement).value,
    ).toBe("Analytical Engine");
    expect((screen.getByRole("textbox", { name: L.jobTitle }) as HTMLInputElement).value).toBe(
      "Mathematician",
    );
    expect(screen.queryByRole("button", { name: L.addField })).toBeNull();
    expect(screen.queryByRole("button", { name: L.addPhone })).toBeNull();
  });

  it("shows notes and birthday read-only when they have a value", () => {
    const withNotes = {
      ...janeWithBirthday,
      notes: { "note-1": { "@type": "Note", note: "Prefers e-mail" } },
    } as unknown as ContactCard;
    renderReadOnly({ card: withNotes, displayName: "Jane Doe" });
    const notes = screen.getByRole("textbox", { name: L.sectionNotes }) as HTMLTextAreaElement;
    expect(notes.value).toBe("Prefers e-mail");
    expect(notes.readOnly).toBe(true);
    const birthday = screen.getByRole("button", { name: /^Birthday:/ }) as HTMLButtonElement;
    expect(birthday.disabled).toBe(true);
    expect(birthday.getAttribute("aria-label")).toMatch(/1985/);
  });
});

describe("ContactsDetailView header", () => {
  it("puts an xl avatar beside the eyebrow and the name", () => {
    const { container } = renderReadOnly({
      card: personWithIdentity,
      eyebrow: <span data-testid="book-switcher">Personal</span>,
    });
    const header = container.querySelector(".contacts-detail-view__header");
    expect(header?.querySelector(".user-avatar--xl")).toBeTruthy();
    const heading = header?.querySelector(".contacts-detail-view__heading");
    expect(heading?.querySelector(".note-detail-view__eyebrow")?.textContent).toBe("Personal");
    expect(heading?.querySelector(".contacts-detail-view__title")).toBeTruthy();
  });

  it("shows a group as an icon and a plain title, with no person fields", () => {
    const { container } = renderReadOnly({
      card: groupCard,
      readOnly: false,
      editDraft: contactCardToEditDraft(groupCard),
      displayName: "Friends",
    });
    const header = container.querySelector(".contacts-detail-view__header");
    expect(header?.querySelector(".contacts-group-icon-slot--xl")).toBeTruthy();
    expect(header?.querySelector(".user-avatar")).toBeNull();
    const title = header?.querySelector(".contacts-detail-view__title");
    expect(title?.textContent).toBe("Friends");
    expect(title?.querySelector("input")).toBeNull();
    expect(screen.queryByText("Should not show")).toBeNull();
    expect(screen.queryByRole("textbox", { name: L.jobTitle })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Birthday:/ })).toBeNull();
    expect(screen.queryByRole("switch", { name: L.companyContact })).toBeNull();
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
    const { container } = renderReadOnly({ card: orgCard, displayName: "Acme Corp" });
    expect(
      container.querySelector(".contacts-detail-view__avatar .contacts-org-icon"),
    ).toBeTruthy();
    expect(container.querySelector(".contacts-group-icon")).toBeNull();
    expect((screen.getByRole("textbox", { name: L.companyName }) as HTMLInputElement).value).toBe(
      "Acme Corp",
    );
  });
});

describe("ContactsDetailView group tags", () => {
  function tagProps(overrides: Partial<NonNullable<ViewProps["groupTags"]>> = {}) {
    return {
      assigned: [{ group: groupCard, writable: true }],
      suggestions: [familyGroup],
      readonly: false,
      allowCreate: true,
      onAdd: vi.fn(),
      onRemove: vi.fn(),
      ...overrides,
    };
  }

  it("sits under the name beside the avatar, washed in the address book colour", () => {
    const { container } = renderReadOnly({ card: personWithIdentity, groupTags: tagProps() });
    const heading = container.querySelector(
      ".contacts-detail-view__header .contacts-detail-view__heading",
    );
    const tags = container.querySelector(".contacts-detail-view__tag-group");
    expect(tags).toBeTruthy();
    expect(heading?.contains(tags)).toBe(true);
    expect(heading?.querySelector(".contacts-detail-view__title")?.nextElementSibling).toBe(tags);

    const chip = screen.getByText("Friends").closest(".tag") as HTMLElement | null;
    const color = addressBookDotColor({ id: "default" });
    expect(chip?.style.getPropertyValue("--tag-bg")).toContain(color);
    expect(chip?.style.getPropertyValue("--tag-fg")).toContain(color);
  });

  it("adds and removes group membership through the shared TagGroup", () => {
    const onAdd = vi.fn();
    const onRemove = vi.fn();
    renderReadOnly({ card: personWithIdentity, groupTags: tagProps({ onAdd, onRemove }) });

    fireEvent.click(screen.getByRole("button", { name: "Remove group Friends" }));
    expect(onRemove).toHaveBeenCalledWith("card-group-friends");

    expect(L.addGroup).toBe("Add to group");
    fireEvent.click(screen.getByRole("button", { name: L.addGroup }));
    const input = screen.getByRole("combobox", { name: L.addGroup });
    expect(input.getAttribute("placeholder")).toBe(L.addGroupPlaceholder);
    fireEvent.change(input, { target: { value: "Fam" } });
    fireEvent.mouseDown(screen.getByRole("option", { name: "Family" }));
    expect(onAdd).toHaveBeenCalledWith("card-group-family");
  });

  it("shows read-only chips for a view-only sharee", () => {
    renderReadOnly({
      card: personWithIdentity,
      groupTags: tagProps({
        assigned: [{ group: groupCard, writable: false }],
        readonly: true,
        allowCreate: false,
      }),
    });
    expect(screen.getByText("Friends")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove group Friends" })).toBeNull();
    expect(screen.queryByRole("button", { name: L.addGroup })).toBeNull();
  });

  it("does not render the tag group when groupTags is omitted (group cards)", () => {
    const { container } = renderReadOnly({ card: groupCard, displayName: "Friends" });
    expect(container.querySelector(".contacts-detail-view__tag-group")).toBeNull();
    expect(container.querySelector(".tag-group")).toBeNull();
  });
});
