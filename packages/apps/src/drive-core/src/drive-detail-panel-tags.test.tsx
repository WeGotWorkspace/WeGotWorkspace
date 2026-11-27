import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DriveDetailPanel } from "@/drive-core/src/drive-detail-panel";
import { DriveRowTags } from "@/drive-core/src/drive-row-tags";
import { driveLabels } from "@/drive-core/src/drive-labels";
import type { DriveFile } from "@/lib/files/drive-models";
import { TooltipProvider } from "@/ui/tooltip";

afterEach(cleanup);

const withTooltips = (node: ReactElement) => <TooltipProvider>{node}</TooltipProvider>;

function file(tags: string[]): DriveFile {
  return {
    id: "plan.txt",
    title: "plan.txt",
    category: "File",
    date: "",
    excerpt: "",
    body: [],
    notebook: "",
    tags,
    wordCount: 0,
    parent: "My Drive",
    kind: "file",
    size: "1 B",
  };
}

describe("DriveDetailPanel tags (#2402)", () => {
  it("removes a tag through the chip and offers the add control", () => {
    const onRemoveTag = vi.fn();
    render(
      withTooltips(
        <DriveDetailPanel
          labels={driveLabels}
          file={file(["client-a", "review"])}
          onClose={() => undefined}
          onAddTag={vi.fn()}
          onRemoveTag={onRemoveTag}
        />,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove tag client-a" }));

    expect(onRemoveTag).toHaveBeenCalledWith("client-a");
    expect(screen.getByText("Add a tag")).not.toBeNull();
  });

  it("shows tags read-only without handlers and hides the section when there are none", () => {
    const { rerender } = render(
      withTooltips(
        <DriveDetailPanel
          labels={driveLabels}
          file={file(["client-a"])}
          onClose={() => undefined}
        />,
      ),
    );
    expect(screen.getByText("client-a")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Remove tag client-a" })).toBeNull();
    expect(screen.queryByText("Add a tag")).toBeNull();

    rerender(
      withTooltips(
        <DriveDetailPanel labels={driveLabels} file={file([])} onClose={() => undefined} />,
      ),
    );
    expect(screen.queryByRole("region", { name: driveLabels.detailTags })).toBeNull();
  });
});

describe("DriveRowTags", () => {
  it("shows two chips and counts the rest", () => {
    render(<DriveRowTags tags={["a", "b", "c", "d"]} />);
    expect(screen.getByText("a")).not.toBeNull();
    expect(screen.getByText("b")).not.toBeNull();
    expect(screen.queryByText("c")).toBeNull();
    expect(screen.getByText("+2")).not.toBeNull();
  });

  it("renders nothing without tags", () => {
    const { container } = render(<DriveRowTags tags={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
