import { describe, expect, it } from "vitest";
import {
  apiPathFromUiPath,
  DRIVE_TRASH_DIR_NAME,
  DRIVE_TRASH_UI_PATH,
  driveUserTrashApiPath,
  isDriveTrashApiPath,
  isDriveTrashFolderName,
  isTopLevelDriveApiPath,
  normalizeApiVirtualPath,
  normalizeDriveFolderUiPath,
  uiPathFromApiPath,
} from "@/drive-core/src/drive-path-utils";

const USER = "alice";
const groupRoots = new Set(["Engineering"]);

describe("normalizeApiVirtualPath", () => {
  it("adds leading slash and strips trailing slashes", () => {
    expect(normalizeApiVirtualPath("users/alice/docs/")).toBe("/users/alice/docs");
  });
});

describe("normalizeDriveFolderUiPath", () => {
  it("prefixes unknown paths with My Drive", () => {
    expect(normalizeDriveFolderUiPath("Projects")).toBe("My Drive/Projects");
  });

  it("preserves known top-level roots", () => {
    expect(normalizeDriveFolderUiPath("Groups/Engineering")).toBe("Groups/Engineering");
    expect(normalizeDriveFolderUiPath("Trash/Old")).toBe("Trash/Old");
  });

  it("defaults empty input to My Drive", () => {
    expect(normalizeDriveFolderUiPath("")).toBe("My Drive");
  });
});

describe("driveUserTrashApiPath", () => {
  it("maps user trash to hidden .Trash directory", () => {
    expect(driveUserTrashApiPath(USER)).toBe(`/users/${USER}/${DRIVE_TRASH_DIR_NAME}`);
  });
});

describe("isDriveTrashApiPath", () => {
  it("detects hidden and legacy trash roots", () => {
    expect(isDriveTrashApiPath(`/users/${USER}/.Trash/item`, USER)).toBe(true);
    expect(isDriveTrashApiPath(`/users/${USER}/Trash/item`, USER)).toBe(true);
    expect(isDriveTrashApiPath(`/users/${USER}/docs`, USER)).toBe(false);
  });
});

describe("isDriveTrashFolderName", () => {
  it("matches trash directory names", () => {
    expect(isDriveTrashFolderName(".Trash")).toBe(true);
    expect(isDriveTrashFolderName("Trash")).toBe(true);
    expect(isDriveTrashFolderName("Archive")).toBe(false);
  });
});

describe("isTopLevelDriveApiPath", () => {
  it("matches personal and group drive roots only", () => {
    expect(isTopLevelDriveApiPath("/users/alice")).toBe(true);
    expect(isTopLevelDriveApiPath("/groups/Engineering")).toBe(true);
    expect(isTopLevelDriveApiPath("/users/alice/docs")).toBe(false);
    expect(isTopLevelDriveApiPath("/groups/Engineering/specs")).toBe(false);
    expect(isTopLevelDriveApiPath("/users")).toBe(false);
    expect(isTopLevelDriveApiPath("/groups")).toBe(false);
    expect(isTopLevelDriveApiPath(undefined)).toBe(false);
  });
});

describe("uiPathFromApiPath", () => {
  it("maps user root and nested files to My Drive UI paths", () => {
    expect(uiPathFromApiPath(`/users/${USER}`, USER)).toBe("My Drive");
    expect(uiPathFromApiPath(`/users/${USER}/Photos`, USER)).toBe("My Drive/Photos");
  });

  it("maps groups API paths to Groups UI paths", () => {
    expect(uiPathFromApiPath("/groups", USER)).toBe("Groups");
    expect(uiPathFromApiPath("/groups/Engineering/specs", USER)).toBe("Groups/Engineering/specs");
  });

  it("maps trash API paths to Trash UI paths", () => {
    expect(uiPathFromApiPath(driveUserTrashApiPath(USER), USER)).toBe(DRIVE_TRASH_UI_PATH);
    expect(uiPathFromApiPath(`/users/${USER}/Trash/old.pdf`, USER)).toBe("Trash/old.pdf");
  });

  it("maps foreign personal paths to Users UI paths", () => {
    expect(uiPathFromApiPath("/users/bob/Projects", USER)).toBe("Users/bob/Projects");
    expect(normalizeDriveFolderUiPath("Users/bob/Projects")).toBe("Users/bob/Projects");
  });
});

describe("apiPathFromUiPath", () => {
  it("maps My Drive UI paths back to user API paths", () => {
    expect(apiPathFromUiPath("My Drive", USER, groupRoots)).toBe(`/users/${USER}`);
    expect(apiPathFromUiPath("My Drive/Photos", USER, groupRoots)).toBe(`/users/${USER}/Photos`);
  });

  it("routes group folders under /groups", () => {
    expect(apiPathFromUiPath("Groups", USER, groupRoots)).toBe("/groups");
    expect(apiPathFromUiPath("My Drive/Engineering/specs", USER, groupRoots)).toBe(
      "/groups/Engineering/specs",
    );
  });

  it("maps Users UI paths back to foreign personal API paths", () => {
    expect(apiPathFromUiPath("Users/bob/Projects", USER, groupRoots)).toBe("/users/bob/Projects");
  });

  it("maps trash UI paths to hidden trash API directory", () => {
    expect(apiPathFromUiPath("Trash", USER, groupRoots)).toBe(driveUserTrashApiPath(USER));
    expect(apiPathFromUiPath("Trash/old.pdf", USER, groupRoots)).toBe(
      `${driveUserTrashApiPath(USER)}/old.pdf`,
    );
  });
});
