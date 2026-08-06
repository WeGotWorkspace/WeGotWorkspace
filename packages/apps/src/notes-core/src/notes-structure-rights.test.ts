import { describe, expect, it } from "vitest";
import type { Note } from "@/lib/models/note";
import { noteAllowsStructureManage } from "@/notes-core/src/notes-structure-rights";

const owned: Note = {
  id: "n-1",
  category: "Note",
  date: "2026-01-01T00:00:00.000Z",
  excerpt: "Hello",
  body: ["Hello"],
  notebook: "Drafts",
  tags: [],
  wordCount: 1,
};

const sharedView: Note = {
  ...owned,
  id: "swm-1",
  sharedInbox: true,
  sharedBy: "bob",
  apiPath: "/users/bob/.notes/Drafts/swm-1.md",
  myRights: { mayEditContent: false },
};

const sharedEdit: Note = {
  ...sharedView,
  id: "swm-edit",
  myRights: { mayEditContent: true },
};

describe("noteAllowsStructureManage", () => {
  it("allows owned notes by default", () => {
    expect(noteAllowsStructureManage(owned)).toBe(true);
  });

  it("allows group notebook notes by default", () => {
    const groupNote: Note = { ...owned, scope: "group", groupSlug: "eng" };
    expect(noteAllowsStructureManage(groupNote)).toBe(true);
  });

  it("denies all personal share recipients", () => {
    expect(noteAllowsStructureManage(sharedView)).toBe(false);
    expect(noteAllowsStructureManage(sharedEdit)).toBe(false);
    expect(noteAllowsStructureManage(sharedEdit, { mayManageStructure: true })).toBe(false);
  });

  it("honors explicit deny on owned notes", () => {
    expect(noteAllowsStructureManage(owned, { mayManageStructure: false })).toBe(false);
  });

  it("locks owned notes while rights are loading without a known value", () => {
    expect(noteAllowsStructureManage(owned, null, true)).toBe(false);
  });
});
