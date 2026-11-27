/** @vitest-environment jsdom */
import "fake-indexeddb/auto";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { fullDriveMyRights } from "@/lib/api/mock/drive-bootstrap";
import type { WgwDriveDirectoryEntry } from "@/lib/api/wgw/types";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { driveEntryRowFromEntry } from "@/lib/offline/drive/drive-directory-offline-store";
import { notifyDriveRemoteChange } from "@/lib/offline/drive/drive-file-node-push";
import { driveEntriesTable } from "@/lib/offline/drive/drive-schema";
import type { DriveEntryArea } from "@/lib/offline/drive/drive-tree-rows";
import { rowInView } from "@/lib/files/tree-view/tree-view-predicates";
import { queryFileTreeTags } from "@/lib/files/tree-view/tree-view-query";
import { useFileTreeTags } from "@/lib/files/tree-view/use-file-tree-tags";

afterEach(cleanup);

let counter = 0;
function freshUser(): string {
  counter += 1;
  return `tagger${counter}`;
}

async function put(username: string, path: string, area: DriveEntryArea, tags?: string[]) {
  const name = path.split("/").pop() ?? "";
  const entry: WgwDriveDirectoryEntry = {
    type: "file",
    path: `/${path}`,
    name,
    size: 1,
    time: 1,
    permissions: 0,
    myRights: fullDriveMyRights,
    ...(tags ? { tags } : {}),
  };
  await driveEntriesTable(offlineDbForAccount(offlineAccountKeyFromUsername(username))).put(
    driveEntryRowFromEntry(entry, area),
  );
}

describe("the tag view of the file tree (#2402)", () => {
  it("rowInView matches a tag, case-insensitively, outside Trash", () => {
    const row = {
      id: "users/a/x.md",
      parentPath: "users/a",
      type: "file" as const,
      area: "home" as const,
      tags: ["client-a"],
    };
    expect(rowInView(row, { kind: "tag", tag: "Client-A" })).toBe(true);
    expect(rowInView(row, { kind: "tag", tag: "other" })).toBe(false);
    expect(rowInView({ ...row, area: "trash" }, { kind: "tag", tag: "client-a" })).toBe(false);
    expect(rowInView({ ...row, tags: undefined }, { kind: "tag", tag: "client-a" })).toBe(false);
  });

  it("lists the tags in use, sorted, leaving out Trash and hidden folders", async () => {
    const user = freshUser();
    await put(user, `users/${user}/a.md`, "home", ["review", "client-a"]);
    await put(user, `users/${user}/b.md`, "home", ["client-a"]);
    await put(user, `groups/team/c.md`, "group", ["team-only"]);
    await put(user, `users/${user}/.Trash/gone.md`, "trash", ["only-in-trash"]);
    await put(user, `users/${user}/.notes/n.md`, "home", ["note-tag"]);
    await put(user, `users/${user}/untagged.md`, "home");

    expect(await queryFileTreeTags(user)).toEqual(["client-a", "review", "team-only"]);
  });

  it("the hook reads again when the drive cache changes", async () => {
    const user = freshUser();
    const { result } = renderHook(() => useFileTreeTags(user));
    await waitFor(() => expect(result.current).toEqual([]));

    await put(user, `users/${user}/a.md`, "home", ["fresh"]);
    act(() => notifyDriveRemoteChange(user));
    await waitFor(() => expect(result.current).toEqual(["fresh"]));
  });
});
