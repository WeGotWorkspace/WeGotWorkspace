import { describe, expect, it } from "vitest";
import {
  accessToUIPermission,
  isDialogEditableAccess,
  NOTES_SHARE_UI_PERMISSIONS,
  SHARE_UI_PERMISSIONS,
  uiPermissionToAccess,
} from "@/share-ui/share-access-map";

describe("share-access-map", () => {
  it("maps UI permissions to API access levels", () => {
    expect(uiPermissionToAccess("view")).toBe("view");
    expect(uiPermissionToAccess("comment")).toBe("comment");
    expect(uiPermissionToAccess("edit")).toBe("edit");
    expect(uiPermissionToAccess("full")).toBe("full");
  });

  it("maps supported API access levels to UI permissions", () => {
    expect(accessToUIPermission("view")).toBe("view");
    expect(accessToUIPermission("comment")).toBe("comment");
    expect(accessToUIPermission("edit")).toBe("edit");
    expect(accessToUIPermission("full")).toBe("full");
  });

  it("folds legacy review into edit for the share dialog", () => {
    expect(accessToUIPermission("review")).toBe("edit");
    expect(isDialogEditableAccess("review")).toBe(true);
  });

  it("exposes view, comment, edit, and full as selectable levels", () => {
    expect(SHARE_UI_PERMISSIONS).toEqual(["view", "comment", "edit", "full"]);
  });

  it("exposes view, edit, and full for Notes mode (no comment)", () => {
    expect(NOTES_SHARE_UI_PERMISSIONS).toEqual(["view", "edit", "full"]);
  });

  it("treats full access as dialog-editable", () => {
    expect(isDialogEditableAccess("full")).toBe(true);
  });
});
