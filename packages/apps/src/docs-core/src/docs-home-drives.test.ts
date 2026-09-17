import { describe, expect, it, vi } from "vitest";
import type { DriveFile } from "@/drive-core/src/drive-models";
import type { DriveAPIOperations, DriveUIData } from "@/drive-core/src/drive-types";
import {
  applyDocsHomeGroupDisplayNames,
  buildDocsFolderPickerRootLabels,
  buildDocsHomeDrives,
  collectGroupRoots,
  collectGroupRootsFromDirectory,
  docsHomeGroupSlugFromPrincipalId,
  fallbackUntitledMarkdownName,
  fetchGroupRootsFromDrive,
  mergeGroupRoots,
  newDocumentApiPath,
  nextUntitledMarkdownName,
  resolveDocsDriveLabel,
  resolveDocsHomeCreateDialogBrowsePath,
  resolveNewDocumentName,
} from "@/docs-core/src/docs-home-drives";

function file(partial: Partial<DriveFile> & { id: string }): DriveFile {
  return {
    category: "document",
    date: "Now",
    title: partial.title ?? partial.id,
    excerpt: "",
    body: [],
    notebook: "",
    tags: [],
    wordCount: 0,
    parent: "My Drive",
    kind: "doc",
    size: "—",
    ...partial,
  };
}

describe("collectGroupRootsFromDirectory", () => {
  it("extracts group folder slugs and prefers entry names as labels", () => {
    const entries = [
      { type: "dir", path: "/groups/Engineering", name: "Engineering" },
      { type: "dir", path: "/groups/design", name: "design" },
      { type: "dir", path: "/groups/administrators", name: "administrators" },
      { type: "file", path: "/groups/readme.txt", name: "readme.txt" },
    ];
    expect(collectGroupRootsFromDirectory(entries)).toEqual([
      { slug: "administrators", label: "administrators" },
      { slug: "design", label: "design" },
      { slug: "Engineering", label: "Engineering" },
    ]);
  });
});

describe("applyDocsHomeGroupDisplayNames", () => {
  it("replaces slug labels with principal display names", () => {
    expect(
      applyDocsHomeGroupDisplayNames(
        [
          { slug: "administrators", label: "administrators" },
          { slug: "design", label: "design" },
        ],
        [
          { id: "principals/groups/administrators", displayName: "Administrators" },
          { id: "groups/design", displayName: "Design" },
        ],
      ),
    ).toEqual([
      { slug: "administrators", label: "Administrators" },
      { slug: "design", label: "Design" },
    ]);
  });
});

describe("docsHomeGroupSlugFromPrincipalId", () => {
  it("strips principals/groups and groups prefixes", () => {
    expect(docsHomeGroupSlugFromPrincipalId("principals/groups/administrators")).toBe(
      "administrators",
    );
    expect(docsHomeGroupSlugFromPrincipalId("groups/eng")).toBe("eng");
    expect(docsHomeGroupSlugFromPrincipalId("eng")).toBe("eng");
  });
});

describe("fetchGroupRootsFromDrive", () => {
  it("lists /groups via drive operations", async () => {
    const operations = {
      listDirectory: vi.fn(async () => ({
        directory: {
          files: [{ type: "dir", path: "/groups/Engineering", name: "Engineering" }],
        },
      })),
    } as unknown as DriveAPIOperations;
    await expect(fetchGroupRootsFromDrive(operations)).resolves.toEqual([
      { slug: "Engineering", label: "Engineering" },
    ]);
    expect(operations.listDirectory).toHaveBeenCalledWith("/groups", undefined);
  });

  it("returns an empty list when operations are unavailable", async () => {
    await expect(fetchGroupRootsFromDrive(undefined)).resolves.toEqual([]);
  });
});

describe("collectGroupRoots", () => {
  it("extracts sorted, unique group roots from /groups/{root} api paths", () => {
    const files = [
      file({ id: "1", apiPath: "/users/alice/a.md" }),
      file({ id: "2", apiPath: "/groups/engineering/rfc.md" }),
      file({ id: "3", apiPath: "/groups/design/brand.md" }),
      file({ id: "4", apiPath: "/groups/engineering/onboarding.md" }),
      file({ id: "5" }),
    ];
    expect(collectGroupRoots(files)).toEqual([
      { slug: "design", label: "design" },
      { slug: "engineering", label: "engineering" },
    ]);
  });

  it("returns an empty list when no group files are present", () => {
    expect(collectGroupRoots([file({ id: "1", apiPath: "/users/alice/a.md" })])).toEqual([]);
  });
});

describe("mergeGroupRoots", () => {
  it("unions and sorts without dropping previously discovered roots", () => {
    expect(
      mergeGroupRoots(
        [{ slug: "engineering", label: "Engineering" }],
        [
          { slug: "design", label: "design" },
          { slug: "engineering", label: "engineering" },
        ],
      ),
    ).toEqual([
      { slug: "design", label: "design" },
      { slug: "engineering", label: "Engineering" },
    ]);
  });

  it("returns the previous reference when the merge is a no-op", () => {
    const previous = [
      { slug: "design", label: "design" },
      { slug: "engineering", label: "Engineering" },
    ];
    const merged = mergeGroupRoots(previous, [
      { slug: "engineering", label: "engineering" },
      { slug: "design", label: "design" },
    ]);
    expect(merged).toBe(previous);
  });

  it("returns previous when next is empty", () => {
    const previous = [{ slug: "eng", label: "Engineering" }];
    expect(mergeGroupRoots(previous, [])).toBe(previous);
  });
});

describe("resolveDocsDriveLabel", () => {
  const groups = [
    { slug: "administrators", label: "Administrators" },
    { slug: "eng", label: "Engineering" },
  ];

  it("maps personal path keys and prefixes to Personal", () => {
    expect(
      resolveDocsDriveLabel("My Drive", { personalDriveLabel: "Personal", groupRoots: groups }),
    ).toBe("Personal");
    expect(
      resolveDocsDriveLabel("users/alice", { personalDriveLabel: "Personal", groupRoots: groups }),
    ).toBe("Personal");
  });

  it("maps group path prefixes and Drive UI paths to principal labels", () => {
    expect(
      resolveDocsDriveLabel("groups/administrators", {
        personalDriveLabel: "Personal",
        groupRoots: groups,
      }),
    ).toBe("Administrators");
    expect(
      resolveDocsDriveLabel("Groups/eng", { personalDriveLabel: "Personal", groupRoots: groups }),
    ).toBe("Engineering");
  });
});

describe("buildDocsFolderPickerRootLabels", () => {
  it("keys Drive UI paths to Docs SST labels", () => {
    expect(
      buildDocsFolderPickerRootLabels(
        [{ slug: "administrators", label: "Administrators" }],
        "Personal",
      ),
    ).toEqual({
      "My Drive": "Personal",
      "Groups/administrators": "Administrators",
    });
  });
});

describe("buildDocsHomeDrives", () => {
  it("lists Personal first, then each group drive with its label", () => {
    const drives = buildDocsHomeDrives(
      "alice",
      [
        { slug: "engineering", label: "Engineering" },
        { slug: "design", label: "design" },
      ],
      "Personal",
    );
    expect(drives).toEqual([
      { key: "users/alice", label: "Personal", pathPrefix: "users/alice" },
      { key: "groups/engineering", label: "Engineering", pathPrefix: "groups/engineering" },
      { key: "groups/design", label: "design", pathPrefix: "groups/design" },
    ]);
  });

  it("omits Personal when the username is blank", () => {
    expect(buildDocsHomeDrives("  ", [{ slug: "eng", label: "Eng" }], "Personal")).toEqual([
      { key: "groups/eng", label: "Eng", pathPrefix: "groups/eng" },
    ]);
  });
});

describe("newDocumentApiPath", () => {
  it("builds a unique Untitled path under the user's drive", () => {
    expect(newDocumentApiPath("alice", [])).toBe("/users/alice/Untitled.md");
  });

  it("avoids collisions with existing loaded files", () => {
    const files = [
      file({ id: "1", title: "Untitled.md" }),
      file({ id: "2", title: "Untitled 2.md" }),
    ];
    expect(newDocumentApiPath("alice", files)).toBe("/users/alice/Untitled 3.md");
  });

  it("returns null when the username is blank", () => {
    expect(newDocumentApiPath("", [])).toBeNull();
  });
});

describe("nextUntitledMarkdownName", () => {
  it("starts at Untitled.md and increments", () => {
    expect(nextUntitledMarkdownName([])).toBe("Untitled.md");
    expect(nextUntitledMarkdownName(["Untitled.md"])).toBe("Untitled 2.md");
    expect(nextUntitledMarkdownName(["Untitled.md", "Untitled 2.md"])).toBe("Untitled 3.md");
  });
});

describe("fallbackUntitledMarkdownName", () => {
  it("includes a timestamp suffix", () => {
    expect(fallbackUntitledMarkdownName(new Date("2026-01-02T03:04:05.000Z"))).toBe(
      "Untitled 2026-01-02 03-04-05.md",
    );
  });
});

describe("resolveDocsHomeCreateDialogBrowsePath", () => {
  it("maps drive prefixes to Drive UI browse paths", () => {
    expect(resolveDocsHomeCreateDialogBrowsePath(null)).toBe("My Drive");
    expect(resolveDocsHomeCreateDialogBrowsePath("users/alice")).toBe("My Drive");
    expect(resolveDocsHomeCreateDialogBrowsePath("groups/Engineering")).toBe("Groups/Engineering");
    expect(resolveDocsHomeCreateDialogBrowsePath("groups/engineering/nested")).toBe(
      "Groups/engineering",
    );
  });
});

describe("resolveNewDocumentName", () => {
  it("uses the live directory listing when operations are available", async () => {
    const operations = {
      listDirectory: vi.fn(async () => {
        const data = {} as DriveUIData;
        data.directory = {
          files: [{ name: "Untitled.md" }, { name: "Untitled 2.md" }],
        } as DriveUIData["directory"];
        return data;
      }),
    } as unknown as Pick<DriveAPIOperations, "listDirectory">;
    await expect(resolveNewDocumentName(operations, "/users/alice", [])).resolves.toBe(
      "Untitled 3.md",
    );
  });

  it("falls back to loaded files without operations", async () => {
    await expect(
      resolveNewDocumentName(undefined, "/users/alice", [file({ id: "1", title: "Untitled.md" })]),
    ).resolves.toBe("Untitled 2.md");
  });
});
