import { describe, expect, it } from "vitest";
import {
  driveFileForSharedWithMeListing,
  driveFileFromEntry,
  driveFileFromSharedWithMeEntry,
  suggestNewMarkdownFileName,
} from "@/drive-core/src/drive-file-utils";

import type { DriveFile } from "@/lib/files/drive-models";
import { fullDriveMyRights } from "@/lib/api/mock/drive-mock-my-rights";
import { SHARED_WITH_ME_UI_ROOT } from "@/lib/files/drive-path-utils";

function file(title: string, kind: DriveFile["kind"] = "doc"): DriveFile {
  return {
    id: title,
    notebook: "",
    category: "",
    date: "",
    title,
    excerpt: "",
    body: [],
    tags: [],
    wordCount: 0,
    parent: "My Drive",
    kind,
    size: "1 KB",
  };
}

describe("suggestNewMarkdownFileName", () => {
  it("returns Untitled.md when unused", () => {
    expect(suggestNewMarkdownFileName([])).toBe("Untitled.md");
  });

  it("increments suffix until unique among non-folder titles", () => {
    const files = [file("Untitled.md"), file("Untitled 2.md")];
    expect(suggestNewMarkdownFileName(files)).toBe("Untitled 3.md");
  });

  it("does not treat folder titles as file name collisions", () => {
    const files = [file("Untitled.md", "folder")];
    expect(suggestNewMarkdownFileName(files)).toBe("Untitled.md");
  });
});

describe("driveFileFromEntry isShared", () => {
  it("maps hasShares from directory listing entries", () => {
    const mapped = driveFileFromEntry(
      {
        type: "file",
        path: "/users/alice/report.md",
        name: "report.md",
        size: 100,
        time: 1,
        permissions: 0,
        myRights: fullDriveMyRights,
        hasShares: true,
      },
      "alice",
    );
    expect(mapped.isShared).toBe(true);
  });

  it("maps granular share flags from directory listing entries", () => {
    const mapped = driveFileFromEntry(
      {
        type: "file",
        path: "/users/alice/report.md",
        name: "report.md",
        size: 100,
        time: 1,
        permissions: 0,
        myRights: fullDriveMyRights,
        hasShares: true,
        hasPublicShare: true,
        hasTeamShare: true,
      },
      "alice",
    );
    expect(mapped.hasPublicShare).toBe(true);
    expect(mapped.hasTeamShare).toBe(true);
    expect(mapped.isShared).toBe(true);
  });

  it("leaves isShared undefined when hasShares is absent", () => {
    const mapped = driveFileFromEntry(
      {
        type: "file",
        path: "/users/alice/private.md",
        name: "private.md",
        size: 100,
        time: 1,
        permissions: 0,
        myRights: fullDriveMyRights,
      },
      "alice",
    );
    expect(mapped.isShared).toBeUndefined();
  });

  it("derives drive location from the API path", () => {
    expect(
      driveFileFromEntry(
        {
          type: "file",
          path: "/users/alice/report.md",
          name: "report.md",
          size: 100,
          time: 1,
          permissions: 0,
          myRights: fullDriveMyRights,
        },
        "alice",
      ).location,
    ).toBe("Personal");
    expect(
      driveFileFromEntry(
        {
          type: "file",
          path: "/groups/engineering/rfc.md",
          name: "rfc.md",
          size: 100,
          time: 1,
          permissions: 0,
          myRights: fullDriveMyRights,
        },
        "alice",
      ).location,
    ).toBe("engineering");
  });

  it("maps mayManageStructure from directory listing myRights", () => {
    const mapped = driveFileFromEntry(
      {
        type: "file",
        path: "/users/alice/shared.md",
        name: "shared.md",
        size: 100,
        time: 1,
        permissions: 0,
        myRights: { ...fullDriveMyRights, mayManageStructure: false, mayShare: false },
      },
      "alice",
    );
    expect(mapped.mayManageStructure).toBe(false);
    expect(mapped.mayShare).toBe(false);
  });
});

describe("driveFileForSharedWithMeListing", () => {
  it("pins resolved entries under the Shared with me virtual root", () => {
    const mapped = driveFileForSharedWithMeListing(
      {
        type: "dir",
        path: "/users/bob/Client Deck",
        name: "Client Deck",
        size: 0,
        time: 1,
        permissions: 0,
        myRights: fullDriveMyRights,
      },
      "alice",
    );
    expect(mapped.parent).toBe(SHARED_WITH_ME_UI_ROOT);
    expect(mapped.apiPath).toBe("/users/bob/Client Deck");
    expect(mapped.kind).toBe("folder");
    expect(mapped.location).toBe("Shared by bob");
    expect(mapped.isShared).toBe(true);
    expect(mapped.hasTeamShare).toBeUndefined();
  });
});

describe("driveFileFromSharedWithMeEntry", () => {
  it("prefers the resolved entry over synthesizing from the share path", () => {
    const mapped = driveFileFromSharedWithMeEntry(
      {
        share: {
          path: "/users/admin/Jaap.md",
          myRights: fullDriveMyRights,
        },
        entry: {
          type: "file",
          path: "/users/admin/Jaap.md",
          name: "Jaap.md",
          size: 42,
          time: 1,
          permissions: 0,
          myRights: fullDriveMyRights,
        },
      },
      "wouter",
    );
    expect(mapped?.title).toBe("Jaap.md");
    expect(mapped?.parent).toBe(SHARED_WITH_ME_UI_ROOT);
    expect(mapped?.size).toBe("42 B");
    expect(mapped?.location).toBe("Shared by admin");
    expect(mapped?.isShared).toBe(true);
    expect(mapped?.hasTeamShare).toBeUndefined();
  });

  it("prefers share.ownerUsername over the path owner segment", () => {
    const mapped = driveFileFromSharedWithMeEntry(
      {
        share: {
          path: "/users/admin/Jaap.md",
          ownerUsername: "hana",
          myRights: fullDriveMyRights,
        },
        entry: {
          type: "file",
          path: "/users/admin/Jaap.md",
          name: "Jaap.md",
          size: 42,
          time: 1,
          permissions: 0,
          myRights: fullDriveMyRights,
        },
      },
      "wouter",
    );
    expect(mapped?.location).toBe("Shared by hana");
  });

  it("falls back to the share path when entry metadata is absent", () => {
    const mapped = driveFileFromSharedWithMeEntry(
      {
        share: {
          path: "/users/admin/Jaap.md",
          myRights: fullDriveMyRights,
          updatedAt: "2026-08-05T10:00:00.000Z",
        },
      },
      "wouter",
    );
    expect(mapped?.title).toBe("Jaap.md");
    expect(mapped?.apiPath).toBe("/users/admin/Jaap.md");
    expect(mapped?.parent).toBe(SHARED_WITH_ME_UI_ROOT);
    expect(mapped?.location).toBe("Shared by admin");
  });
});
