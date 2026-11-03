import { beforeEach, describe, expect, it, vi } from "vitest";
import { JmapSetItemError } from "@/lib/jmap-client";
import { createDriveFileKeepingBoth } from "@/lib/api/wgw/drive-create-keep-both";

const setFileNodes = vi.fn();
const queryAndGetFileNodes = vi.fn();
const uploadJmapBlob = vi.fn(async () => "blob-1");

vi.mock("@/lib/api/wgw/drive-jmap", () => ({
  driveJmapSession: vi.fn(async () => ({
    accountId: "acc",
    fileNodes: { setFileNodes, queryAndGetFileNodes },
  })),
  fetchDriveUser: vi.fn(async () => ({ username: "alice" })),
  resolveFileNodeId: vi.fn(async () => "parent-1"),
  uploadJmapBlob: (...args: unknown[]) => uploadJmapBlob(...(args as [])),
}));

function file(name: string, text = "mine"): File {
  return new File([text], name, { type: "text/markdown" });
}

function siblings(...nodes: Array<{ name: string; size?: number; nodeType?: string }>) {
  queryAndGetFileNodes.mockResolvedValue({
    list: nodes.map((node) => ({ size: 0, nodeType: "file", ...node })),
  });
}

const taken = () => new JmapSetItemError("create", "f0", { type: "alreadyExists" });

describe("createDriveFileKeepingBoth (#1563)", () => {
  beforeEach(() => {
    setFileNodes.mockReset();
    queryAndGetFileNodes.mockReset();
    uploadJmapBlob.mockClear();
  });

  it("creates under the wanted name when it is free", async () => {
    setFileNodes.mockResolvedValue({});

    await expect(createDriveFileKeepingBoth("/users/alice", file("Plan.md"))).resolves.toBe(
      "Plan.md",
    );
    expect(setFileNodes).toHaveBeenCalledWith(
      {
        accountId: "acc",
        create: { f0: { parentId: "parent-1", name: "Plan.md", blobId: "blob-1" } },
      },
      { signal: undefined },
    );
  });

  it("keeps both under the first free name when the server has the name", async () => {
    setFileNodes.mockRejectedValueOnce(taken()).mockResolvedValueOnce({});
    siblings({ name: "Plan.md" }, { name: "Plan (2).md" });

    await expect(createDriveFileKeepingBoth("/users/alice", file("Plan.md"))).resolves.toBe(
      "Plan (1).md",
    );
    expect(setFileNodes.mock.calls[1]![0].create.f0.name).toBe("Plan (1).md");
  });

  it("never replaces: any other create error is thrown", async () => {
    setFileNodes.mockRejectedValue(new Error("Failed to fetch"));

    await expect(createDriveFileKeepingBoth("/users/alice", file("Plan.md"))).rejects.toThrow(
      "Failed to fetch",
    );
    expect(setFileNodes).toHaveBeenCalledTimes(1);
  });

  it("takes a same-size file as its own lost create when a retry may have landed", async () => {
    siblings({ name: "plan.md", size: file("Plan.md").size });

    await expect(
      createDriveFileKeepingBoth("/users/alice", file("Plan.md"), { mayHaveLanded: true }),
    ).resolves.toBe("plan.md");
    expect(uploadJmapBlob).not.toHaveBeenCalled();
    expect(setFileNodes).not.toHaveBeenCalled();
  });

  it("keeps both on a retry when the file there is a different one", async () => {
    siblings({ name: "Plan.md", size: 999 });
    setFileNodes.mockRejectedValueOnce(taken()).mockResolvedValueOnce({});

    await expect(
      createDriveFileKeepingBoth("/users/alice", file("Plan.md"), { mayHaveLanded: true }),
    ).resolves.toBe("Plan (1).md");
  });
});
