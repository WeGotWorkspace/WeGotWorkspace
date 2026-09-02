import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultContactsLabels } from "./contacts-labels";
import { ContactContextTypeSelect } from "./contact-channel-type-select";

afterEach(() => {
  cleanup();
});

describe("ContactContextTypeSelect", () => {
  it("uses the form md size and keeps an accessible name", () => {
    render(
      <ContactContextTypeSelect
        labels={defaultContactsLabels}
        value="home"
        ariaLabel={`${defaultContactsLabels.channelType} ${defaultContactsLabels.sectionAddresses}`}
        onChange={vi.fn()}
      />,
    );

    const trigger = screen.getByRole("combobox", {
      name: `${defaultContactsLabels.channelType} ${defaultContactsLabels.sectionAddresses}`,
    });
    expect(trigger.classList.contains("select-trigger--size-sm")).toBe(false);
    expect(trigger.classList.contains("contacts-detail-view__context-select")).toBe(true);
    expect(document.querySelector(".share-dialog__permission-item")).toBeNull();
    expect(document.querySelector(".contacts-detail-view__context-select-item")).not.toBeNull();
  });
});
