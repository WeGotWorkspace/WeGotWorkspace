import { describe, expect, it } from "vitest";
import { defaultContactsLabels } from "@/contacts-core/src/contacts-labels";

describe("contacts create-collection labels", () => {
  it("matches Notes/Tasks overflow copy for create group", () => {
    expect(defaultContactsLabels.newGroup).toBe("New group");
    expect(defaultContactsLabels.newContactMenu).toBe("More create options");
    expect(defaultContactsLabels.createGroupButton).toBe("Create");
    expect(defaultContactsLabels.addGroup).toBe("Add group");
    expect(defaultContactsLabels.addGroupPlaceholder).toBe("Add group…");
  });

  it("matches Notes/Tasks owned vs shared section headings", () => {
    expect(defaultContactsLabels.sectionAddressBooks).toBe("My address books");
    expect(defaultContactsLabels.sidebarSharedWithMe).toBe("Shared with me");
    expect(defaultContactsLabels.personalAddressBook).toBe("Personal");
  });

  it("matches Notes move-collection copy for the address-book switcher", () => {
    expect(defaultContactsLabels.toolbarMoveToAddressBook).toBe("Change address book");
    expect(defaultContactsLabels.toastMovedToAddressBook("Engineering")).toBe(
      "Moved to “Engineering”",
    );
    expect(defaultContactsLabels.moveContactTitle).toBe("Move contact?");
    expect(defaultContactsLabels.moveContactConfirm).toBe("Move");
    expect(defaultContactsLabels.moveContactDescription("Engineering")).toBe(
      "Move this contact to “Engineering”?",
    );
    expect(defaultContactsLabels.moveContactDescriptionWithGroups("Engineering")).toBe(
      "Move this contact to “Engineering”? They will be removed from groups in the current address book.",
    );
  });
});
