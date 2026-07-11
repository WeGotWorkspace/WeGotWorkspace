import { describe, expect, it } from "vitest";
import {
  accessToUIPermission,
  isDialogEditableAccess,
  uiPermissionToAccess,
} from "@/share-ui/share-access-map";

describe("share-access-map", () => {
  it("maps UI permissions to API access levels", () => {
    expect(uiPermissionToAccess("view")).toBe("view");
    expect(uiPermissionToAccess("suggest")).toBe("review");
    expect(uiPermissionToAccess("edit")).toBe("edit");
    expect(uiPermissionToAccess("full")).toBe("full");
  });

  it("maps supported API access levels to UI permissions", () => {
    expect(accessToUIPermission("view")).toBe("view");
    expect(accessToUIPermission("review")).toBe("suggest");
    expect(accessToUIPermission("edit")).toBe("edit");
    expect(accessToUIPermission("full")).toBe("full");
  });

  it("hides comment from the share dialog dropdown", () => {
    expect(accessToUIPermission("comment")).toBeNull();
    expect(isDialogEditableAccess("comment")).toBe(false);
  });

  it("treats full access as dialog-editable", () => {
    expect(isDialogEditableAccess("full")).toBe(true);
  });
});
