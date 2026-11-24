// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { contactsViewPrefs } from "@/contacts-core/src/contacts-view-prefs";
import { createMockProjectOperations } from "@/lib/api/mock/projects";
import { writeProjectFilter } from "@/lib/projects/project-filter";
import { createProjectsStore, resetProjectsStoreForTests } from "@/lib/projects/projects-store";
import {
  addressBooksHiddenByProject,
  teamAddressBookId,
  useContactsHiddenIds,
} from "@/contacts-core/src/use-contacts-hidden-ids";

const books = [{ id: "default" }, { id: "group-design" }, { id: "group-sales" }];

describe("addressBooksHiddenByProject", () => {
  it("hides nothing under All Projects", () => {
    expect([...addressBooksHiddenByProject(books, null)]).toEqual([]);
  });

  it("keeps only the owning Team's address book for a Project", () => {
    expect(teamAddressBookId("design")).toBe("group-design");
    expect([...addressBooksHiddenByProject(books, "design")]).toEqual(["default", "group-sales"]);
  });
});

describe("useContactsHiddenIds", () => {
  afterEach(() => {
    resetProjectsStoreForTests();
    localStorage.clear();
  });

  it("joins the books the user hid with the books the Project filter hides", async () => {
    const store = createProjectsStore(createMockProjectOperations());
    await store.load();
    resetProjectsStoreForTests(store);
    contactsViewPrefs.patch({
      hiddenAddressBookIds: ["group-sales"],
      knownAddressBookIds: books.map((book) => book.id),
    });
    writeProjectFilter("t:design");

    const { result } = renderHook(() => useContactsHiddenIds(books));

    expect([...result.current.hiddenAddressBookIds].sort()).toEqual(["default", "group-sales"]);
    expect(typeof result.current.setHiddenAddressBookIds).toBe("function");
  });
});
