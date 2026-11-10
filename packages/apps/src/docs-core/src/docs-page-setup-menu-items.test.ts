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
  it("lists None first, then the paper sizes, orientation and Fit to screen", () => {
    expect(rows(A4_LANDSCAPE).map((row) => row.label)).toEqual([
      "None",
      "A4",
      "A3",
      "A5",
      "Letter",
      "Legal",
      "Portrait",
      "Landscape",
      "Fit to screen",
    ]);
    expect(
      rows(A4_LANDSCAPE)
        .filter((row) => row.checked)
        .map((row) => row.label),
    ).toEqual(["A4", "Landscape"]);
  });

  it("turns orientation and Fit to screen off without paper", () => {
    const list = rows({ ...NONE, fitToScreen: true });
    expect(list.filter((row) => row.checked).map((row) => row.label)).toEqual(["None"]);
    expect(list.filter((row) => row.disabled).map((row) => row.label)).toEqual([
      "Portrait",
      "Landscape",
      "Fit to screen",
    ]);
  });

  it("toggles Fit to screen in its own section", () => {
    const entries = docsPageSetupMenuItems({
      pageSetup: A4_LANDSCAPE,
      setPageSetup: vi.fn(),
      labels: docsLabels,
    });
    expect(entries.at(-2)).toEqual({ type: "separator", id: "after-orientation" });

    const turnOn = vi.fn();
    rows(A4_LANDSCAPE, turnOn).at(-1)?.onClick?.();
    expect(turnOn).toHaveBeenCalledWith({ fitToScreen: true });

    const fitted = rows({ ...A4_LANDSCAPE, fitToScreen: true });
    expect(fitted.at(-1)?.checked).toBe(true);
    const turnOff = vi.fn();
    rows({ ...A4_LANDSCAPE, fitToScreen: true }, turnOff)
      .at(-1)
      ?.onClick?.();
    expect(turnOff).toHaveBeenCalledWith({ fitToScreen: false });
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
