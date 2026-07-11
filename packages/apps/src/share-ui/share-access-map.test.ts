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
  });

  it("maps supported API access levels to UI permissions", () => {
    expect(accessToUIPermission("view")).toBe("view");
    expect(accessToUIPermission("review")).toBe("suggest");
    expect(accessToUIPermission("edit")).toBe("edit");
  });

  it("hides comment and full from the share dialog dropdown", () => {
    expect(accessToUIPermission("comment")).toBeNull();
    expect(accessToUIPermission("full")).toBeNull();
    expect(isDialogEditableAccess("comment")).toBe(false);
    expect(isDialogEditableAccess("full")).toBe(false);
  });
});
