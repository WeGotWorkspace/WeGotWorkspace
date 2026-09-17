import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { addressBookDotColor } from "@/contacts-core/src/contacts-addressbook-color";
import { ContactUserAvatar } from "@/contacts-core/src/contact-user-avatar";
import type { ContactCard } from "@/contacts-core/src/contacts-types";
import {
  CONTACTS_VIEW_PREFS_STORAGE_KEY,
  persistAddressBookColor,
} from "@/contacts-core/src/contacts-view-prefs";

const groupCard = {
  "@type": "Card",
  version: "1.0",
  id: "card-group-friends",
  uid: "urn:uuid:group-friends",
  kind: "group",
  name: { full: "Friends" },
  addressBookIds: { "group-eng": true },
} as unknown as ContactCard;

const personCard = {
  "@type": "Card",
  version: "1.0",
  id: "card-jane",
  uid: "urn:uuid:jane",
  kind: "individual",
  name: { full: "Jane Doe" },
  addressBookIds: { default: true },
} as unknown as ContactCard;

const personWithPhoto = {
  ...personCard,
  media: {
    "media-1": {
      "@type": "Media" as const,
      kind: "photo" as const,
      uri: "https://example.com/photos/jane.jpg",
    },
  },
} as unknown as ContactCard;

const orgCard = {
  "@type": "Card",
  version: "1.0",
  id: "card-acme",
  uid: "urn:uuid:acme",
  kind: "org",
  name: { full: "Acme Corp" },
  organizations: {
    "org-1": { "@type": "Organization", name: "Acme Corp" },
  },
  addressBookIds: { default: true },
} as unknown as ContactCard;

function bookColorOn(container: HTMLElement): string {
  return (
    (
      container.querySelector(".contacts-user-avatar") as HTMLElement | null
    )?.style.getPropertyValue("--contacts-book-color") ?? ""
  );
}

describe("ContactUserAvatar", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.removeItem(CONTACTS_VIEW_PREFS_STORAGE_KEY);
  });

  it("renders a book-tinted group icon for kind: group cards", () => {
    const { container } = render(<ContactUserAvatar card={groupCard} size="sm" compact />);
    const icon = container.querySelector(".contacts-group-icon") as HTMLElement | null;
    expect(icon).toBeTruthy();
    expect(container.querySelector(".user-avatar")).toBeNull();
    expect(icon?.style.getPropertyValue("--collection-row-color")).toBe(
      addressBookDotColor({ id: "group-eng" }),
    );
  });

  it("keeps the user avatar for people", () => {
    const { container } = render(<ContactUserAvatar card={personCard} size="sm" compact />);
    expect(container.querySelector(".user-avatar")).toBeTruthy();
    expect(container.querySelector(".contacts-group-icon")).toBeNull();
  });

  it("tints the initials swatch from the card's address book", () => {
    const { container } = render(<ContactUserAvatar card={personCard} size="sm" compact />);
    expect(bookColorOn(container)).toBe(addressBookDotColor({ id: "default" }));
    expect(container.querySelector(".user-avatar__mark")?.textContent).toMatch(/J/);
  });

  it("uses a different book hex for a different addressBookIds key", () => {
    const workCard = {
      ...personCard,
      addressBookIds: { work: true },
    } as unknown as ContactCard;
    const { container } = render(<ContactUserAvatar card={workCard} size="sm" compact />);
    expect(bookColorOn(container)).toBe(addressBookDotColor({ id: "work" }));
    expect(bookColorOn(container)).not.toBe(addressBookDotColor({ id: "default" }));
  });

  it("updates the initials swatch when the book color override changes", async () => {
    const { container } = render(<ContactUserAvatar card={personCard} size="sm" compact />);
    expect(bookColorOn(container)).toBe(addressBookDotColor({ id: "default" }));
    persistAddressBookColor("default", "#22c55e");
    await waitFor(() => {
      expect(bookColorOn(container)).toBe("#22c55e");
    });
  });

  it("leaves --contacts-book-color unset when there is no card book", () => {
    const { container } = render(<ContactUserAvatar displayName="Pat Example" size="sm" compact />);
    expect(container.querySelector(".contacts-user-avatar")).toBeTruthy();
    expect(bookColorOn(container)).toBe("");
  });

  it("tints org fallback chrome from the book and does not hash the org name", () => {
    const { container } = render(<ContactUserAvatar card={orgCard} size="sm" compact />);
    expect(bookColorOn(container)).toBe(addressBookDotColor({ id: "default" }));
    expect(container.querySelector(".contacts-org-icon")).toBeTruthy();
  });

  it("keeps a photo img uncolored while still storing the book hex for fallback", () => {
    const { container } = render(<ContactUserAvatar card={personWithPhoto} size="sm" compact />);
    const img = container.querySelector("img.user-avatar__image");
    expect(img?.getAttribute("src")).toBe("https://example.com/photos/jane.jpg");
    expect(img?.getAttribute("style") ?? "").toBe("");
    expect(bookColorOn(container)).toBe(addressBookDotColor({ id: "default" }));
  });

  it("uses the xl group-icon slot for detail-sized avatars", () => {
    const { container } = render(<ContactUserAvatar card={groupCard} size="xl" compact />);
    expect(container.querySelector(".contacts-group-icon-slot--xl")).toBeTruthy();
    expect(container.querySelector(".contacts-group-icon-slot--lg")).toBeNull();
  });

  it("shows a company icon instead of initials for org cards in the list", () => {
    const { container } = render(
      <ContactUserAvatar
        card={orgCard}
        size="sm"
        compact
        className="contacts-list-panel__avatar"
      />,
    );
    const mark = container.querySelector(".user-avatar__mark");
    expect(container.querySelector(".contacts-org-icon")).toBeTruthy();
    expect(container.querySelector(".contacts-group-icon")).toBeNull();
    expect(mark?.textContent).not.toMatch(/A/);
  });

  it("shows a company icon instead of initials for org cards in the detail header", () => {
    const { container } = render(
      <ContactUserAvatar
        card={orgCard}
        size="xl"
        compact
        className="contacts-detail-view__avatar"
      />,
    );
    expect(container.querySelector(".user-avatar--xl .contacts-org-icon")).toBeTruthy();
    expect(container.querySelector(".user-avatar__mark")?.textContent).not.toMatch(/A/);
  });

  it("applies native lazy-load attributes on list photo imgs", () => {
    const { container } = render(
      <ContactUserAvatar
        card={personWithPhoto}
        size="sm"
        compact
        className="contacts-list-panel__avatar"
        loading="lazy"
        decoding="async"
      />,
    );
    const img = container.querySelector("img.user-avatar__image");
    expect(img?.getAttribute("src")).toBe("https://example.com/photos/jane.jpg");
    expect(img?.getAttribute("loading")).toBe("lazy");
    expect(img?.getAttribute("decoding")).toBe("async");
  });

  it("keeps detail-header photo imgs eager", () => {
    const { container } = render(
      <ContactUserAvatar
        card={personWithPhoto}
        size="xl"
        compact
        className="contacts-detail-view__avatar"
      />,
    );
    const img = container.querySelector("img.user-avatar__image");
    expect(img).toBeTruthy();
    expect(img?.getAttribute("loading")).toBeNull();
    expect(img?.getAttribute("decoding")).toBeNull();
  });
});
