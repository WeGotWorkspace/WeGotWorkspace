import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ContactsGroupIcon } from "@/contacts-core/src/contacts-group-icon";
import { CONTACTS_VIEW_PREFS_STORAGE_KEY } from "@/contacts-core/src/contacts-view-prefs";

describe("ContactsGroupIcon", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.removeItem(CONTACTS_VIEW_PREFS_STORAGE_KEY);
  });

  it("renders a decorative group glyph, not a rounded swatch", () => {
    const { container } = render(<ContactsGroupIcon />);
    const icon = container.querySelector(".contacts-group-icon");
    expect(icon).toBeTruthy();
    expect(icon?.tagName.toLowerCase()).toBe("svg");
    expect(icon?.getAttribute("class") ?? "").not.toMatch(/rounded-full/);
    expect(container.querySelector(".collection-sidebar-row__dot")).toBeNull();
  });

  it("carries no colour: groups follow their address book, which has none", () => {
    const { container } = render(<ContactsGroupIcon />);
    const icon = container.querySelector(".contacts-group-icon") as HTMLElement | null;
    expect(icon?.style.getPropertyValue("--collection-row-color")).toBe("");
  });
});
