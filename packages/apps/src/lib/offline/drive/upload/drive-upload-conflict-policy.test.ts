import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FakeDriveServer,
  memoryLocalStorage,
  patternedFile,
} from "@/lib/offline/drive/upload/drive-upload-fake-server.fixture";

const fake = vi.hoisted(() => ({ server: null as unknown as FakeDriveServer }));

vi.mock("@/lib/api/wgw/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/wgw/http")>()),
  wgwFetch: (path: string, init?: RequestInit) => fake.server.fetch(path, init),
}));

import { DriveUploadPermanentError } from "@/lib/api/wgw/drive-upload-errors";
import { JmapSetItemError } from "@/lib/jmap-client";
import { classifyDriveUploadFailure } from "@/lib/offline/drive/upload/drive-upload-failure";
import type {
  DriveUploadConflictChoice,
  DriveUploadNotice,
  DriveUploadReplaceTarget,
} from "@/lib/offline/drive/upload/drive-upload-schema";
import { transferDriveUpload } from "@/lib/offline/drive/upload/drive-upload-transfer";

let server: FakeDriveServer;
let notices: Array<DriveUploadNotice | undefined>;

function existing(name: string, blobId = "jb-old", extra: { contentHashPending?: boolean } = {}) {
  const row = { id: `fn-${name}`, parentId: "fn-docs", name, blobId, ...extra };
  server.nodes.push(row);
  return row;
}

function upload(
  name: string,
  conflict?: DriveUploadConflictChoice,
  replaceTarget?: DriveUploadReplaceTarget,
) {
  return transferDriveUpload(server.session(), {
    username: "ada",
    folderId: "fn-docs",
    name,
    mimeType: "text/plain",
    blob: patternedFile(name, 50),
    ...(conflict ? { conflict } : {}),
    ...(replaceTarget ? { replaceTarget } : {}),
    onCreated: async (_nodeId, notice) => {
      notices.push(notice);
    },
  });
}

function names() {
  return server.nodes.map((row) => row.name);
}

describe("conflict policy at upload time", () => {
  beforeEach(() => {
    server = new FakeDriveServer();
    fake.server = server;
    notices = [];
    vi.stubGlobal("localStorage", memoryLocalStorage());
  });

  afterEach(() => vi.unstubAllGlobals());

  it.each(["skip", "replace", "keep_both", undefined] as const)(
    "uploads under its own name when the name is free at upload time (choice %s)",
    async (choice) => {
      const result = await upload("report.pdf", choice, { nodeId: "fn-gone", blobId: "jb-x" });
      expect(result).toMatchObject({ kind: "uploaded", finalName: "report.pdf" });
      expect(names()).toEqual(["report.pdf"]);
      expect(notices).toEqual([undefined]);
      expect(server.fileNodeSets.every((set) => set.create)).toBe(true);
    },
  );

  it("keeps both without a stored choice, and records a notice naming both files", async () => {
    existing("report.pdf");
    const result = await upload("report.pdf");

    expect(result).toMatchObject({ kind: "uploaded", finalName: "report (1).pdf" });
    expect(notices).toEqual([
      { type: "kept_both", itemName: "report.pdf", keptAsName: "report (1).pdf" },
    ]);
  });

  it("keeps both with the user's choice without a notice", async () => {
    existing("report.pdf");
    const result = await upload("report.pdf", "keep_both");

    expect(result).toMatchObject({ kind: "uploaded", finalName: "report (1).pdf" });
    expect(notices).toEqual([undefined]);
  });

  it("takes the next free name when the picked one was taken in the meantime", async () => {
    existing("report.pdf");
    existing("report (1).pdf");
    const set = server.fileNodes.setFileNodes;
    let raced = false;
    server.fileNodes.setFileNodes = async (args) => {
      const create = (args.create as Record<string, { name: string }> | undefined)?.upload;
      if (create && !raced) {
        raced = true;
        existing(create.name);
      }
      return set(args);
    };
    const result = await upload("report.pdf", "keep_both");

    expect(result).toMatchObject({ kind: "uploaded", finalName: "report (3).pdf" });
  });

  it("skips only a colliding file, without sending its bytes", async () => {
    existing("report.pdf");
    const result = await upload("report.pdf", "skip");

    expect(result).toEqual({ kind: "skipped" });
    expect(server.uploads).toEqual([]);
    expect(names()).toEqual(["report.pdf"]);
  });

  it("replaces with an update of the seen node, carrying expectedBlobId", async () => {
    const row = existing("report.pdf", "jb-seen");
    const result = await upload("report.pdf", "replace", { nodeId: row.id, blobId: "jb-seen" });

    expect(result).toMatchObject({ kind: "uploaded", finalName: "report.pdf" });
    const update = server.fileNodeSets.at(-1)!.update as Record<string, Record<string, string>>;
    expect(update[row.id]).toEqual({ blobId: row.blobId, expectedBlobId: "jb-seen" });
    expect(server.nodes).toHaveLength(1);
    expect(server.fileNodeSets.some((set) => set.create)).toBe(false);
  });

  it("falls back to keep both with a replace_fell_back notice when the file changed (versionMismatch)", async () => {
    const row = existing("report.pdf", "jb-changed");
    const result = await upload("report.pdf", "replace", { nodeId: row.id, blobId: "jb-seen" });

    expect(result).toMatchObject({ kind: "uploaded", finalName: "report (1).pdf" });
    expect(row.blobId).toBe("jb-changed");
    expect(notices).toEqual([
      { type: "replace_fell_back", itemName: "report.pdf", keptAsName: "report (1).pdf" },
    ]);
  });

  it("falls back when another file now holds the name", async () => {
    existing("report.pdf", "jb-seen");
    const result = await upload("report.pdf", "replace", {
      nodeId: "fn-deleted",
      blobId: "jb-seen",
    });

    expect(result).toMatchObject({ kind: "uploaded", finalName: "report (1).pdf" });
    expect(notices[0]?.type).toBe("replace_fell_back");
  });

  it("does not read invalidProperties as a changed file, and classifies it as usual", async () => {
    const row = existing("report.pdf", "jb-seen");
    server.fileNodes.setFileNodes = async () => {
      throw new JmapSetItemError("update", row.id, {
        type: "invalidProperties",
        properties: ["expectedBlobId"],
      });
    };
    const failure = await upload("report.pdf", "replace", {
      nodeId: row.id,
      blobId: "jb-seen",
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(JmapSetItemError);
    expect(names()).toEqual(["report.pdf"]);
    expect(classifyDriveUploadFailure(failure)).toMatchObject({
      kind: "fail",
      error: { code: "upload_failed" },
    });
  });

  it("fails as permanent instead of overwriting when the capability disappeared", async () => {
    const row = existing("report.pdf", "jb-seen");
    server.versionCheck = false;
    const failure = await upload("report.pdf", "replace", {
      nodeId: row.id,
      blobId: "jb-seen",
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(DriveUploadPermanentError);
    expect(server.fileNodeSets.some((set) => set.update)).toBe(false);
    expect(classifyDriveUploadFailure(failure)).toMatchObject({ error: { code: "upload_failed" } });
  });

  it("keeps both with a notice for a colliding file under replace that has no stored target", async () => {
    existing("other.txt");
    const result = await upload("other.txt", "replace");

    expect(result).toMatchObject({ kind: "uploaded", finalName: "other (1).txt" });
    expect(notices[0]?.type).toBe("kept_both");
  });

  it("repeats the same FileNode/set while the server attaches a large blob in steps", async () => {
    const set = server.fileNodes.setFileNodes;
    let attaching = 2;
    server.fileNodes.setFileNodes = async (args) => {
      if (attaching > 0) {
        attaching -= 1;
        throw new JmapSetItemError("create", "upload", { type: "attachInProgress", copied: 1 });
      }
      return set(args);
    };
    const result = await upload("big.bin");
    expect(result).toMatchObject({ kind: "uploaded", finalName: "big.bin" });
  });
});
