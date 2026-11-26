import { describe, expect, it } from "vitest";
import {
  isKnownTreeFolder,
  isShareRootRow,
  isTrashItemPath,
  matchesEntryFilter,
  rowInView,
  type FileTreeRowColumns,
  type FileTreeView,
} from "@/lib/files/tree-view/tree-view-predicates";

function row(
  id: string,
  area: FileTreeRowColumns["area"],
  type: "file" | "dir" = id.includes(".", id.lastIndexOf("/") + 2) ? "file" : "dir",
): FileTreeRowColumns {
  const parentPath = id.split("/").slice(0, -1).join("/");
  const name = id.split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  return {
    id,
    parentPath,
    type,
    area,
    ...(type === "file" ? { ext: dot > 0 ? name.slice(dot + 1).toLowerCase() : "" } : {}),
  };
}

const ALL_VIEWS: FileTreeView[] = [
  { kind: "folder", path: "users/ada" },
  { kind: "folder", path: "users/ada/.notes" },
  { kind: "folder", path: "users/ada/Plans/.attachments" },
  { kind: "all" },
  { kind: "recent" },
  { kind: "starred" },
  { kind: "shared" },
  { kind: "trash" },
  { kind: "prefix", path: "users/ada" },
];

describe("tree view predicates", () => {
  it("dot folders other than Trash are not listed", () => {
    const hidden = [
      row("users/ada/.notes", "home", "dir"),
      row("users/ada/.notes/body.md", "home"),
      row("users/ada/Plans/.attachments", "home", "dir"),
      row("users/ada/Plans/.attachments/scan.png", "home"),
      row("users/bob/Shared/.notes/body.md", "share"),
    ];
    for (const view of ALL_VIEWS) {
      for (const hiddenRow of hidden) {
        expect(rowInView(hiddenRow, view), `${hiddenRow.id} in ${JSON.stringify(view)}`).toBe(
          false,
        );
      }
    }
  });

  it("Trash appears only in the Trash view", () => {
    const trashFolder = row("users/ada/.Trash", "trash", "dir");
    const trashed = row("users/ada/.Trash/old.md", "trash");
    for (const view of ALL_VIEWS.filter((v) => v.kind !== "trash")) {
      expect(rowInView(trashFolder, view), JSON.stringify(view)).toBe(false);
      expect(rowInView(trashed, view), JSON.stringify(view)).toBe(false);
    }
    expect(rowInView(trashed, { kind: "trash" })).toBe(true);
    expect(rowInView(trashFolder, { kind: "trash" })).toBe(false);
  });

  it("the Trash view lists trashed items, not rows inside a trashed folder", () => {
    expect(rowInView(row("users/ada/.Trash/Old", "trash", "dir"), { kind: "trash" })).toBe(true);
    expect(rowInView(row("users/ada/.Trash/Old/a.md", "trash"), { kind: "trash" })).toBe(false);
    expect(isTrashItemPath("groups/team/.Trash/x.md")).toBe(true);
    // Browsing into a trashed folder still lists its children.
    expect(
      rowInView(row("users/ada/.Trash/Old/a.md", "trash"), {
        kind: "folder",
        path: "/users/ada/.Trash/Old",
      }),
    ).toBe(true);
  });

  it("a folder view lists its direct children, files and folders", () => {
    const view: FileTreeView = { kind: "folder", path: "/users/ada/" };
    expect(rowInView(row("users/ada/Plans", "home", "dir"), view)).toBe(true);
    expect(rowInView(row("users/ada/a.md", "home"), view)).toBe(true);
    expect(rowInView(row("users/ada/Plans/b.md", "home"), view)).toBe(false);
  });

  it("a folder view lists rows a first sync wrote before their area is known", () => {
    expect(rowInView(row("users/ada/a.md", undefined), { kind: "folder", path: "users/ada" })).toBe(
      true,
    );
  });

  it("area views need the area a complete pass sets", () => {
    const pending = row("users/ada/a.md", undefined);
    expect(rowInView(pending, { kind: "all" })).toBe(false);
    expect(rowInView(pending, { kind: "shared" })).toBe(false);
    expect(rowInView(pending, { kind: "trash" })).toBe(false);
    expect(rowInView(pending, { kind: "recent" })).toBe(false);
  });

  it("all files are flat files of home and team drives", () => {
    expect(rowInView(row("users/ada/Plans/a.md", "home"), { kind: "all" })).toBe(true);
    expect(rowInView(row("groups/team/b.md", "group"), { kind: "all" })).toBe(true);
    expect(rowInView(row("users/ada/Plans", "home", "dir"), { kind: "all" })).toBe(false);
    expect(rowInView(row("users/bob/c.md", "share"), { kind: "all" })).toBe(false);
  });

  it("recent lists files outside Trash from every area", () => {
    expect(rowInView(row("users/bob/c.md", "share"), { kind: "recent" })).toBe(true);
    expect(rowInView(row("users/ada/Plans", "home", "dir"), { kind: "recent" })).toBe(false);
  });

  it("a prefix view lists every file under its path, flat", () => {
    const view: FileTreeView = { kind: "prefix", path: "/groups/team/Launch" };
    expect(rowInView(row("groups/team/Launch/a.md", "group"), view)).toBe(true);
    expect(rowInView(row("groups/team/Launch/Deep/b.md", "group"), view)).toBe(true);
    expect(rowInView(row("groups/team/Launcher/c.md", "group"), view)).toBe(false);
    expect(rowInView(row("groups/team/Launch/Deep", "group", "dir"), view)).toBe(false);
  });

  it("shared lists share roots only", () => {
    const shareRows = [
      row("users/bob/Shared", "share", "dir"),
      row("users/bob/Shared/inner.md", "share"),
      row("users/cy/one.md", "share"),
    ];
    const sharePaths = new Set(shareRows.map((r) => r.id));
    expect(shareRows.filter((r) => isShareRootRow(r, sharePaths)).map((r) => r.id)).toEqual([
      "users/bob/Shared",
      "users/cy/one.md",
    ]);
  });

  it("the entry filter narrows files by extension and name, folders only when files-only", () => {
    const docs = { extensions: ["md", "txt"] };
    expect(matchesEntryFilter(row("users/ada/a.md", "home"), docs)).toBe(true);
    expect(matchesEntryFilter(row("users/ada/a.png", "home"), docs)).toBe(false);
    expect(matchesEntryFilter(row("users/ada/Plans", "home", "dir"), docs)).toBe(true);
    expect(matchesEntryFilter(row("users/ada/Plans", "home", "dir"), { filesOnly: true })).toBe(
      false,
    );
    expect(matchesEntryFilter(row("users/ada/Budget.md", "home"), { nameQuery: " budg " })).toBe(
      true,
    );
    expect(
      matchesEntryFilter(row("users/ada/Plans/notes.md", "home"), { nameQuery: "plans" }),
    ).toBe(false);
    expect(matchesEntryFilter(row("users/ada/a.md", "home"), undefined)).toBe(true);
  });

  it("a folder is known when it has a row, is an account root, or is above one", () => {
    const roots = ["/users/ada", "/groups/team"];
    expect(isKnownTreeFolder("users/ada", undefined, roots)).toBe(true);
    expect(isKnownTreeFolder("/groups", undefined, roots)).toBe(true);
    expect(isKnownTreeFolder("", undefined, roots)).toBe(true);
    expect(isKnownTreeFolder("users/ada/Plans", row("users/ada/Plans", "home", "dir"), roots)).toBe(
      true,
    );
    expect(isKnownTreeFolder("users/ada/Missing", undefined, roots)).toBe(false);
    expect(
      isKnownTreeFolder("users/ada/.notes", row("users/ada/.notes", "home", "dir"), roots),
    ).toBe(false);
  });
});
