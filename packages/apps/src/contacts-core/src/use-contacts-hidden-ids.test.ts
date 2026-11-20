import { describe, expect, it } from "vitest";
import {
  addressBooksHiddenByProject,
  teamAddressBookId,
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
