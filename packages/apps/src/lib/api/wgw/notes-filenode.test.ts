import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JmapFileNodePathCache } from "@/lib/jmap-client";
import type { JmapFileNode } from "@/lib/jmap-client";

const { driveJmapSession, fetchDriveUser, resolveFileNodeId } = vi.hoisted(() => ({
  driveJmapSession: vi.fn(),
  fetchDriveUser: vi.fn(),
  resolveFileNodeId: vi.fn(),
}));

const { setDriveFileStar } = vi.hoisted(() => ({
  setDriveFileStar: vi.fn(),
}));

vi.mock("@/lib/api/wgw/drive-jmap", () => ({
  driveJmapSession,
  fetchDriveUser,
  resolveFileNodeId,
}));

vi.mock("@/lib/api/wgw/drive", () => ({
  setDriveFileStar,
}));

import {
  coerceFileNodeNote,
  createNoteViaFileNode,
  isNotesVirtualPath,
  listOwnedNotesFromFileNodes,
  noteIdFromFileName,
  parseNoteVirtualPath,
  updateNoteViaFileNode,
} from "@/lib/api/wgw/notes-filenode";

function fileNode(
  partial: Partial<JmapFileNode> & Pick<JmapFileNode, "id" | "name">,
): JmapFileNode {
  return {
    parentId: partial.parentId ?? "root",
    nodeType: partial.nodeType ?? "file",
    blobId: partial.blobId ?? null,
    size: partial.size ?? 0,
    type: partial.type ?? "text/markdown",
    ...partial,
  };
}

describe("note path helpers", () => {
  it("parses personal, archive, and group note paths", () => {
    expect(parseNoteVirtualPath("/users/bob/.notes/Drafts/welcome.md")).toEqual({
      scope: "personal",
      owner: "bob",
      groupSlug: null,
      notebook: "Drafts",
      noteId: "welcome",
      archived: false,
      path: "/users/bob/.notes/Drafts/welcome.md",
    });
    expect(parseNoteVirtualPath("users/bob/.notes/.archive/Drafts/old.md")).toMatchObject({
      archived: true,
      notebook: "Drafts",
      noteId: "old",
    });
    expect(parseNoteVirtualPath("/groups/team/.notes/Roadmap/n1.md")).toMatchObject({
      scope: "group",
      owner: "team",
      groupSlug: "team",
      notebook: "Roadmap",
      noteId: "n1",
    });
    expect(parseNoteVirtualPath("/users/bob/drive-doc.md")).toBeNull();
    expect(isNotesVirtualPath("/users/bob/.notes/Drafts/welcome.md")).toBe(true);
    expect(isNotesVirtualPath("/users/bob/drive-doc.md")).toBe(false);
    expect(noteIdFromFileName("welcome.md")).toBe("welcome");
    expect(noteIdFromFileName("scratch.txt")).toBeNull();
  });

  it("coerces FileNode note projection without reading a YAML starred field", () => {
    expect(
      coerceFileNodeNote({
        title: "Hello",
        tags: ["a"],
        excerpt: "body preview",
        notebook: "Drafts",
        archived: false,
        starred: false,
      }),
    ).toEqual({
      title: "Hello",
      tags: ["a"],
      excerpt: "body preview",
      notebook: "Drafts",
      archived: false,
      starred: false,
    });
    expect(coerceFileNodeNote({ title: "Nope" })).toBeNull();
  });
});

describe("listOwnedNotesFromFileNodes", () => {
  const queryAndGetFileNodes = vi.fn();
  const setFileNodes = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    fetchDriveUser.mockResolvedValue({ username: "bob" });
    resolveFileNodeId.mockImplementation(async (_session: unknown, path: string) => {
      if (path.endsWith("/.notes")) return "notes-root";
      throw new Error(`FileNode not found: ${path}`);
    });
    driveJmapSession.mockResolvedValue({
      fileNodes: { queryAndGetFileNodes, setFileNodes },
      cache: new JmapFileNodePathCache(),
      accountId: "bob",
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("maps FileNode notes and personal notebooks; Drive starred is the only star source", async () => {
    queryAndGetFileNodes.mockImplementation(
      async (_accountId: string, filter: { isTopLevel?: boolean; ancestorId?: string }) => {
        if (filter.isTopLevel) {
          return {
            list: [fileNode({ id: "home", name: "bob", nodeType: "directory", parentId: null })],
          };
        }
        return {
          list: [
            fileNode({ id: "nb", name: "Drafts", nodeType: "directory", parentId: "notes-root" }),
            fileNode({
              id: "n1",
              name: "welcome.md",
              parentId: "nb",
              modified: "2026-06-01T12:00:00.000Z",
              changed: "2024-01-01T00:00:00.000Z",
              note: {
                title: "Welcome",
                tags: ["intro"],
                excerpt: "Hello body",
                notebook: "Drafts",
                archived: false,
                starred: false,
              },
            }),
          ],
        };
      },
    );

    const listing = await listOwnedNotesFromFileNodes();
    expect(listing.username).toBe("bob");
    expect(listing.notebooks).toEqual(["Drafts"]);
    expect(listing.notes).toHaveLength(1);
    expect(listing.notes[0]?.starred).toBe(false);
    expect(listing.notes[0]?.excerpt).toContain("Hello body");
    expect(listing.notes[0]?.apiPath).toBe("/users/bob/.notes/Drafts/welcome.md");
    expect(setDriveFileStar).not.toHaveBeenCalled();
  });
});

describe("createNoteViaFileNode + star", () => {
  const queryAndGetFileNodes = vi.fn();
  const setFileNodes = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    fetchDriveUser.mockResolvedValue({ username: "bob" });
    resolveFileNodeId.mockResolvedValue("parent-id");
    queryAndGetFileNodes.mockResolvedValue({
      list: [fileNode({ id: "home", name: "bob", nodeType: "directory", parentId: null })],
    });
    setFileNodes.mockResolvedValue({
      created: {
        n0: fileNode({
          id: "created-1",
          name: "fresh.md",
          note: {
            title: "",
            tags: ["alpha"],
            excerpt: "",
            notebook: "Drafts",
            archived: false,
            starred: false,
          },
        }),
      },
    });
    driveJmapSession.mockResolvedValue({
      fileNodes: { queryAndGetFileNodes, setFileNodes },
      cache: new JmapFileNodePathCache(),
      accountId: "bob",
    });
  });

  it("creates via FileNode/set and stars via Drive REST, not a notes metadata PUT", async () => {
    const saved = await createNoteViaFileNode({
      id: "fresh",
      notebook: "Drafts",
      tags: ["alpha"],
      starred: true,
    });

    expect(setFileNodes).toHaveBeenCalledWith(
      expect.objectContaining({
        create: {
          n0: expect.objectContaining({
            name: "fresh.md",
            note: { title: "", tags: ["alpha"] },
          }),
        },
      }),
      expect.anything(),
    );
    const createArg = setFileNodes.mock.calls[0]?.[0] as {
      create: { n0: { note: Record<string, unknown> } };
    };
    expect(createArg.create.n0.note).not.toHaveProperty("starred");
    expect(setDriveFileStar).toHaveBeenCalledWith(
      "/users/bob/.notes/Drafts/fresh.md",
      true,
      undefined,
    );
    expect(saved.starred).toBe(true);
    expect(saved.tags).toEqual(["alpha"]);
  });
});

describe("updateNoteViaFileNode", () => {
  const queryAndGetFileNodes = vi.fn();
  const setFileNodes = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    fetchDriveUser.mockResolvedValue({ username: "bob" });
    resolveFileNodeId.mockImplementation(async (_session: unknown, path: string) => {
      if (path === "/users/bob/.notes") return "notes-root";
      return "node-id";
    });
    setFileNodes.mockResolvedValue({ updated: {} });
    driveJmapSession.mockResolvedValue({
      fileNodes: { queryAndGetFileNodes, setFileNodes },
      cache: new JmapFileNodePathCache(),
      accountId: "bob",
    });
  });

  it("patches tags via FileNode and writes stars via Drive", async () => {
    queryAndGetFileNodes.mockImplementation(
      async (
        _accountId: string,
        filter: { isTopLevel?: boolean; ancestorId?: string; name?: string },
      ) => {
        if (filter.isTopLevel) {
          return {
            list: [fileNode({ id: "home", name: "bob", nodeType: "directory", parentId: null })],
          };
        }
        if (filter.name === "welcome.md") {
          return {
            list: [
              fileNode({
                id: "fn-welcome",
                name: "welcome.md",
                parentId: "nb",
                note: {
                  title: "Welcome",
                  tags: ["old"],
                  excerpt: "Hello",
                  notebook: "Drafts",
                  archived: false,
                  starred: false,
                },
              }),
            ],
          };
        }
        return { list: [] };
      },
    );

    const saved = await updateNoteViaFileNode("welcome", {
      notebook: "Drafts",
      tags: ["beta"],
      starred: true,
    });

    expect(setFileNodes).toHaveBeenCalledWith(
      expect.objectContaining({
        update: {
          "fn-welcome": { note: { tags: ["beta"] } },
        },
      }),
      expect.anything(),
    );
    const updateArg = setFileNodes.mock.calls[0]?.[0] as {
      update: { "fn-welcome": { note: Record<string, unknown> } };
    };
    expect(updateArg.update["fn-welcome"]?.note).not.toHaveProperty("starred");
    expect(setDriveFileStar).toHaveBeenCalledWith(
      "/users/bob/.notes/Drafts/welcome.md",
      true,
      undefined,
    );
    expect(saved.starred).toBe(true);
    expect(saved.tags).toEqual(["beta"]);
  });
});
