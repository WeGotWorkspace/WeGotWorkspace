import { describe, expect, it } from "vitest";
import {
  buildPermanentDeleteDescription,
  workspaceDestructiveDialogLabels,
} from "@/lib/workspace/destructive-dialog";
import { mergeWorkspaceLabels, workspaceLabels } from "@/lib/workspace/workspace-labels";

type SampleLabels = { title: string; count: (n: number) => string; cancel: string };

const defaults: SampleLabels = {
  title: "Title",
  count: (n) => `${n} items`,
  cancel: workspaceLabels.dialog.cancel,
};

describe("mergeWorkspaceLabels", () => {
  it("returns the defaults when there are no overrides", () => {
    expect(mergeWorkspaceLabels(defaults)).toBe(defaults);
    expect(mergeWorkspaceLabels(defaults, undefined)).toBe(defaults);
  });

  it("applies partial overrides and keeps the other defaults", () => {
    const merged = mergeWorkspaceLabels(defaults, { title: "Other" });
    expect(merged.title).toBe("Other");
    expect(merged.cancel).toBe("Cancel");
    expect(merged.count(2)).toBe("2 items");
    expect(defaults.title).toBe("Title");
  });

  it("accepts a function label override", () => {
    const merged = mergeWorkspaceLabels(defaults, { count: (n) => `${n} notes` });
    expect(merged.count(3)).toBe("3 notes");
  });
});

describe("workspaceDestructiveDialogLabels", () => {
  it("reads from the shared base", () => {
    expect(workspaceDestructiveDialogLabels).toEqual({
      dialogCancel: workspaceLabels.dialog.cancel,
      dialogDelete: workspaceLabels.dialog.delete,
      dialogDeleteConfirmSuffix: workspaceLabels.dialog.deleteConfirmSuffix,
      dialogPermanentDeleteLeadIn: workspaceLabels.dialog.permanentDeleteLeadIn,
    });
  });

  it("builds the permanent-delete sentence", () => {
    expect(
      buildPermanentDeleteDescription({
        leadIn: workspaceLabels.dialog.permanentDeleteLeadIn,
        target: "2 notes",
        suffix: workspaceLabels.dialog.deleteConfirmSuffix,
      }),
    ).toBe("This will permanently delete 2 notes. This action cannot be undone.");
  });
});
