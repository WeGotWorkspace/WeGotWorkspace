import { describe, expect, it } from "vitest";
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
});
