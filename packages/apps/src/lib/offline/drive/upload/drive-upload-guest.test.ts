import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DriveUIData } from "@/lib/files/drive-types";
import type { WgwDriveDirectoryEntry } from "@/lib/api/wgw/types";
import { JmapRequestError } from "@/lib/jmap-client/core/errors";

const session = vi.hoisted(() => ({ result: null as null | { accountId: string } | Error }));
vi.mock("@/lib/api/wgw/drive-jmap", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/wgw/drive-jmap")>()),
  driveJmapSession: async () => {
    if (session.result instanceof Error) throw session.result;
    return session.result;
  },
}));

const { guestUploadQueueOperations, resolveGuestUploadAccount } =
  await import("@/lib/offline/drive/upload/drive-upload-guest");
const { upsertDriveEntry } = await import("@/lib/offline/drive/drive-directory-offline-store");

const GUEST = "guest-0123456789abcdef0123456789abcdef";

describe("resolveGuestUploadAccount (#1715)", () => {
  beforeEach(() => {
    session.result = null;
  });

  it("returns the guest account when the server opens an upload Session", async () => {
    session.result = { accountId: GUEST };
    await expect(resolveGuestUploadAccount()).resolves.toBe(GUEST);
  });

  it("returns null when the link does not allow uploads (the Session answers 403)", async () => {
    session.result = new JmapRequestError("Failed to fetch JMAP session (403)", { status: 403 });
    await expect(resolveGuestUploadAccount()).resolves.toBeNull();
  });

  it("rethrows a transient failure so the caller can retry", async () => {
    session.result = new JmapRequestError("Failed to fetch JMAP session (503)", { status: 503 });
    await expect(resolveGuestUploadAccount()).rejects.toThrow("503");
    session.result = new TypeError("Failed to fetch");
    await expect(resolveGuestUploadAccount()).rejects.toThrow("Failed to fetch");
    session.result = { accountId: GUEST };
    await expect(resolveGuestUploadAccount()).resolves.toBe(GUEST);
  });

  it("never treats a member account as a guest upload account", async () => {
    session.result = { accountId: "ada" };
    await expect(resolveGuestUploadAccount()).resolves.toBeNull();
  });
});

describe("guestUploadQueueOperations (#1715)", () => {
  it("reads the folder's queue rows from the guest account, not the owner's", async () => {
    const user = {
      username: "owner",
      name: "",
      role: "guest",
      roots: ["/users/owner/Drop"],
    } as unknown as DriveUIData["user"];
    const operations = guestUploadQueueOperations(GUEST, user);
    expect(typeof operations.enqueueUploads).toBe("function");
    await expect(operations.readCachedDirectory?.("/users/owner/Drop")).resolves.toBeNull();

    const entry = {
      type: "file" as const,
      path: "/users/owner/Drop/a.txt",
      name: "a.txt",
      size: 1,
      time: 0,
      permissions: 0,
    } as WgwDriveDirectoryEntry;
    await upsertDriveEntry("owner", entry);
    await expect(operations.readCachedDirectory?.("/users/owner/Drop")).resolves.toBeNull();

    await upsertDriveEntry(GUEST, entry);
    const cached = await operations.readCachedDirectory?.("/users/owner/Drop");
    expect(cached?.directory.files.map((file) => file.name)).toEqual(["a.txt"]);
    expect(cached?.user).toBe(user);
  });
});
