import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultContactsLabels } from "./contacts-labels";
import { ContactContextTypeSelect, ContactPhoneTypeSelect } from "./contact-channel-type-select";

afterEach(() => {
  cleanup();
});

const addressTypeLabel = `${defaultContactsLabels.channelType} ${defaultContactsLabels.sectionAddresses}`;

describe("ContactContextTypeSelect", () => {
  it("uses the ghost dropdown trigger with an accessible name and the current type", () => {
    render(
      <ContactContextTypeSelect
        labels={defaultContactsLabels}
        value="home"
        ariaLabel={addressTypeLabel}
        onChange={vi.fn()}
      />,
    );

    const trigger = screen.getByRole("combobox", { name: addressTypeLabel });
    expect(trigger.classList.contains("collection-ghost-select")).toBe(true);
    expect(trigger.classList.contains("contacts-detail-view__context-select")).toBe(true);
    // Not the old form select (bordered, md size).
    expect(trigger.classList.contains("select-trigger--size-md")).toBe(false);
    expect(trigger.querySelector(".collection-ghost-select__name")?.textContent).toBe(
      defaultContactsLabels.channelTypeHome,
    );
    expect(trigger.querySelector(".collection-ghost-select__chevron")).not.toBeNull();
    expect(document.querySelector(".contacts-detail-view__context-select-item")).toBeNull();
  });

  it("keeps the chevron (dimmed) and disables the trigger when read-only", () => {
    render(
      <ContactContextTypeSelect
        labels={defaultContactsLabels}
        value="work"
        ariaLabel={addressTypeLabel}
        disabled
        onChange={vi.fn()}
      />,
    );

    const trigger = screen.getByRole("combobox", { name: addressTypeLabel }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
    expect(trigger.textContent).toBe(defaultContactsLabels.channelTypeWork);
    // The value still reads as a choice, only dimmed.
    expect(trigger.querySelector(".collection-ghost-select__chevron")).not.toBeNull();
  });
});

describe("ContactPhoneTypeSelect", () => {
  it("shows the phone type on the ghost trigger", () => {
    const name = `${defaultContactsLabels.channelType} ${defaultContactsLabels.phoneNumber}`;
    render(
      <ContactPhoneTypeSelect
        labels={defaultContactsLabels}
        value="mobile"
        ariaLabel={name}
        onChange={vi.fn()}
      />,
    );

    const trigger = screen.getByRole("combobox", { name });
    expect(trigger.classList.contains("collection-ghost-select")).toBe(true);
    expect(trigger.textContent).toBe(defaultContactsLabels.channelTypeMobile);
  });
});
