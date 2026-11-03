import { describe, expect, it, vi } from "vitest";
import {
  docsPageSetupButtonLabel,
  docsPageSetupMenuItems,
} from "@/docs-core/src/docs-page-setup-menu-items";
import { docsLabels } from "@/docs-core/src/docs-labels";
import type { DropdownMenuEntry, DropdownMenuItemProps } from "@/menu-dropdown/src/dropdown-menu";
import type { TextEditorPageSetup } from "@/lib/page-format";

function rows(pageSetup: TextEditorPageSetup, setPageSetup = vi.fn()) {
  return docsPageSetupMenuItems({ pageSetup, setPageSetup, labels: docsLabels }).filter(
    (entry: DropdownMenuEntry): entry is DropdownMenuItemProps => !("type" in entry),
  );
}

const A4_LANDSCAPE: TextEditorPageSetup = {
  format: "a4",
  orientation: "landscape",
  layout: "pages",
};
const NONE: TextEditorPageSetup = {
  format: "none",
  orientation: "landscape",
  layout: "continuous",
};

describe("docsPageSetupMenuItems", () => {
  it("lists None first, then the paper sizes and orientation", () => {
    expect(rows(A4_LANDSCAPE).map((row) => row.label)).toEqual([
      "None",
      "A4",
      "A3",
      "A5",
      "Letter",
      "Legal",
      "Portrait",
      "Landscape",
    ]);
    expect(
      rows(A4_LANDSCAPE)
        .filter((row) => row.checked)
        .map((row) => row.label),
    ).toEqual(["A4", "Landscape"]);
  });

  it("turns orientation off without paper", () => {
    const list = rows(NONE);
    expect(list.filter((row) => row.checked).map((row) => row.label)).toEqual(["None"]);
    expect(list.filter((row) => row.disabled).map((row) => row.label)).toEqual([
      "Portrait",
      "Landscape",
    ]);
  });

  it("saves None as the paper choice", () => {
    const setPageSetup = vi.fn();
    rows(A4_LANDSCAPE, setPageSetup)[0]?.onClick?.();
    expect(setPageSetup).toHaveBeenCalledWith({ format: "none" });
  });
});

describe("docsPageSetupButtonLabel", () => {
  it("names the paper and orientation", () => {
    expect(docsPageSetupButtonLabel(A4_LANDSCAPE, docsLabels)).toBe("Page setup: A4, Landscape");
    expect(docsPageSetupButtonLabel(NONE, docsLabels)).toBe("Page setup: None");
  });
});
