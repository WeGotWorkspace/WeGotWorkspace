import { describe, expect, it } from "vitest";
import { backupDownloadUrl } from "@/admin-core/src/admin-backup";

describe("backupDownloadUrl", () => {
  it("encodes the backup name into the download path", () => {
    expect(backupDownloadUrl("release 1/backup.zip")).toBe(
      "/api/v1/admin/updates/backups/release%201%2Fbackup.zip",
    );
  });
});
