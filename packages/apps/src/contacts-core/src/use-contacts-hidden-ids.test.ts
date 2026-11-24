import { describe, expect, it } from "vitest";
import {
  addressBooksHiddenByProject,
  teamAddressBookId,
  viewAfterProjectFilter,
} from "@/contacts-core/src/use-contacts-hidden-ids";

const books = [{ id: "default" }, { id: "group-design" }, { id: "group-sales" }];

describe("addressBooksHiddenByProject", () => {
  it("hides nothing under All Projects", () => {
    expect([...addressBooksHiddenByProject(books, null)]).toEqual([]);
  });

  it("drops every Team address book under Personal and keeps the rest", () => {
    const withShared = [...books, { id: "shared-abc" }];
    expect([...addressBooksHiddenByProject(withShared, null, true)]).toEqual([
      "group-design",
      "group-sales",
    ]);
  });

  it("hides nothing under All Teams", () => {
    expect([...addressBooksHiddenByProject(books, null, false)]).toEqual([]);
  });

  it("keeps only the owning Team's address book for a Project", () => {
    expect(teamAddressBookId("design")).toBe("group-design");
    expect([...addressBooksHiddenByProject(books, "design")]).toEqual(["default", "group-sales"]);
  });
});

describe("viewAfterProjectFilter", () => {
  const personalHidden = addressBooksHiddenByProject(books, null, true);

  it("leaves an open Team book view under Personal", () => {
    expect(viewAfterProjectFilter("book:group-design", personalHidden)).toBe("all");
  });

  it("leaves a group view whose book is hidden", () => {
    expect(viewAfterProjectFilter("group:g1", personalHidden, "group-sales")).toBe("all");
  });

  it("keeps views of books the filter keeps", () => {
    expect(viewAfterProjectFilter("book:default", personalHidden)).toBe("book:default");
    expect(viewAfterProjectFilter("all", personalHidden)).toBe("all");
  });
});
