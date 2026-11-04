import { describe, expect, it, vi } from "vitest";
import { driveLabels } from "@/drive-core/src/drive-labels";
import { driveUploadPlaceholderMenu } from "@/drive-core/src/drive-upload-placeholder-menu";

describe("driveUploadPlaceholderMenu", () => {
  it("puts the placeholder's own actions first and disables server-only ones with a reason", () => {
    const remove = { id: "upload-remove", label: "Remove", icon: null };
    const menu = driveUploadPlaceholderMenu(driveLabels, [remove]);
    expect(menu[0]).toBe(remove);
    const rest = menu.slice(1);
    expect(rest.map((action) => action.id).sort()).toEqual([
      "download",
      "move",
      "open",
      "rename",
      "share",
    ]);
    for (const action of rest) {
      expect(action.disabled).toBe(true);
      expect(action.onClick).toBeUndefined();
      expect(action.description).toBe(driveLabels.uploadActionUnavailable);
    }
  });

  it("keeps Download working when the placeholder can save its local copy", () => {
    const onDownload = vi.fn();
    const menu = driveUploadPlaceholderMenu(driveLabels, [], onDownload);
    const download = menu.find((action) => action.id === "download");
    expect(download?.disabled).toBeFalsy();
    download?.onClick?.();
    expect(onDownload).toHaveBeenCalledOnce();
    const others = menu.filter((action) => action.id !== "download");
    expect(others.every((action) => action.disabled)).toBe(true);
  });

  it("gives a folder placeholder a working Open and no Download (#1620)", () => {
    const onOpen = vi.fn();
    const menu = driveUploadPlaceholderMenu(driveLabels, [], undefined, { onOpen });
    expect(menu.map((action) => action.id)).not.toContain("download");
    const openAction = menu.find((action) => action.id === "open");
    expect(openAction?.disabled).toBeFalsy();
    openAction?.onClick?.();
    expect(onOpen).toHaveBeenCalledOnce();
    const others = menu.filter((action) => action.id !== "open");
    expect(others.every((action) => action.disabled)).toBe(true);
  });
});
