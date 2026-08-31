import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { addressBookDotColor } from "@/contacts-core/src/contacts-addressbook-color";
import { ContactsGroupIcon } from "@/contacts-core/src/contacts-group-icon";

describe("ContactsGroupIcon", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders a decorative group glyph, not a rounded swatch", () => {
    const { container } = render(<ContactsGroupIcon book="default" />);
    const icon = container.querySelector(".contacts-group-icon");
    expect(icon).toBeTruthy();
    expect(icon?.tagName.toLowerCase()).toBe("svg");
    expect(icon?.getAttribute("class") ?? "").not.toMatch(/rounded-full/);
    expect(container.querySelector(".collection-sidebar-row__dot")).toBeNull();
  });

  it("tints from the address-book client hash, not a group-id hash", () => {
    const { container } = render(
      <ContactsGroupIcon book={{ addressBookIds: { "group-eng": true } }} />,
    );
    const icon = container.querySelector(".contacts-group-icon") as HTMLElement | null;
    expect(icon?.style.getPropertyValue("--collection-row-color")).toBe(
      addressBookDotColor({ id: "group-eng" }),
    );
    expect(icon?.style.getPropertyValue("--collection-row-color")).not.toBe(
      addressBookDotColor({ id: "card-group-friends" }),
    );
  });

  it("tints from an explicit book id", () => {
    const { container } = render(<ContactsGroupIcon book="default" />);
    const icon = container.querySelector(".contacts-group-icon") as HTMLElement | null;
    expect(icon?.style.getPropertyValue("--collection-row-color")).toBe(
      addressBookDotColor({ id: "default" }),
    );
  });

  it("leaves --collection-row-color unset when the book cannot be resolved", () => {
    const { container } = render(<ContactsGroupIcon />);
    const icon = container.querySelector(".contacts-group-icon") as HTMLElement | null;
    expect(icon?.style.getPropertyValue("--collection-row-color")).toBe("");
  });
});
