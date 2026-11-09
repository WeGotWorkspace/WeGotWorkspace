import type { ReactElement } from "react";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { driveLabels } from "./drive-labels";
import type { DriveFile } from "@/lib/files/drive-models";
import { useDriveMutations } from "./use-drive-mutations";
import { buildList, buildShell } from "./use-drive-mutations-fixtures";
import type { DriveShellState } from "./use-drive-shell";

// The selection zip is named after what the header shows (#1905).

const FILES: DriveFile[] = ["a.md", "b.md"].map((title, index) => ({
  id: `f-${index}`,
  notebook: "File",
  category: "doc",
  date: "Now",
  title,
  excerpt: "",
  body: [],
  tags: [],
  wordCount: 0,
  parent: "Plans",
  kind: "doc",
  size: "1 KB",
  apiPath: `/users/testuser/Plans/${title}`,
}));

function zipNameFor(searchQuery: string): unknown {
  const downloadSelection = vi.fn(async (_paths: string[], _name: string) => undefined);
  const base = buildShell();
  const shell = buildShell({
    labels: driveLabels,
    files: FILES,
    viewLabel: "Plans",
    searchQuery,
    operations: { ...base.operations, downloadSelection } as DriveShellState["operations"],
  });
  const list = buildList({ selectedIds: ["f-0", "f-1"], selectionMode: true });
  const { result } = renderHook(() => useDriveMutations({ shell, list }));
  const bar = result.current.selectionBar as ReactElement<{
    buttons: { label: string; onClick?: () => void }[];
  }>;
  bar.props.buttons.find((button) => button.label === driveLabels.selectionDownload)?.onClick?.();
  return downloadSelection.mock.calls[0]?.[1];
}

describe("useDriveMutations selection zip name", () => {
  it("names the zip after the folder in view", () => {
    expect(zipNameFor("")).toBe("Plans");
  });

  it("names the zip Search while search results are shown", () => {
    expect(zipNameFor("roadmap")).toBe(driveLabels.searchViewTitle);
    expect(zipNameFor("   ")).toBe("Plans");
  });
});
