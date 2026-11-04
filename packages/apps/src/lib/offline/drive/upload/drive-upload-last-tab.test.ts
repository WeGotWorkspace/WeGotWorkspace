import { describe, expect, it } from "vitest";
import { isLastDriveUploaderTab } from "@/lib/offline/drive/upload/drive-upload-last-tab";
import { driveUploaderLockName } from "@/lib/offline/drive/upload/drive-upload-lock-name";

describe("isLastDriveUploaderTab (#1522)", () => {
  const name = driveUploaderLockName("alice");

  it("is the last tab when it alone holds the uploader lock", async () => {
    const query = async () => ({ held: [{ name }], pending: [{ name: "other-lock" }] });
    await expect(isLastDriveUploaderTab("alice", query)).resolves.toBe(true);
  });

  it("is not the last tab when another tab waits for the lock", async () => {
    const query = async () => ({ held: [{ name }], pending: [{ name }] });
    await expect(isLastDriveUploaderTab("alice", query)).resolves.toBe(false);
  });

  it("counts every tab as the last without the Web Locks API", async () => {
    await expect(isLastDriveUploaderTab("alice", null)).resolves.toBe(true);
  });
});
