import { describe, expect, it } from "vitest";
import { sortNotes, type NotesListSort } from "@/notes-core/src/notes-list-sort";

const note = (id: string, title: string | undefined, date: string) => ({
  id,
  title,
  date,
  excerpt: "",
  body: [],
});

const notes = () => [
  note("b", "banana", "2026-03-02T10:00:00Z"),
  note("a", "Apple", "2026-03-01T10:00:00Z"),
  note("c", "cherry 10", "2026-03-03T10:00:00Z"),
  note("d", "cherry 2", "—"),
  note("e", undefined, "2026-03-04T10:00:00Z"),
];

const order = (sort: NotesListSort) => sortNotes(notes(), sort).map((n) => n.id);

describe("sortNotes", () => {
  it("keeps the list as handed over for newest edit first", () => {
    expect(order({ key: "modified", direction: "desc" })).toEqual(["b", "a", "c", "d", "e"]);
  });

  it("sorts oldest first and leaves notes without a date last", () => {
    expect(order({ key: "modified", direction: "asc" })).toEqual(["a", "b", "c", "e", "d"]);
  });

  it("sorts titles A to Z, numbers naturally, untitled notes by their shown title", () => {
    const ids = order({ key: "title", direction: "asc" });
    expect(ids.slice(0, 4)).toEqual(["a", "b", "d", "c"]);
    expect(ids).toHaveLength(5);
  });

  it("reverses titles for Z to A", () => {
    expect(order({ key: "title", direction: "desc" })).toEqual(
      order({ key: "title", direction: "asc" }).reverse(),
    );
  });

  it("breaks ties on id", () => {
    const same = [note("z", "Same", "—"), note("y", "Same", "—")];
    expect(sortNotes(same, { key: "title", direction: "asc" }).map((n) => n.id)).toEqual([
      "y",
      "z",
    ]);
  });
});
