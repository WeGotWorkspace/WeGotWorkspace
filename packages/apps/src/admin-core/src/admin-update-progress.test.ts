import { describe, expect, it } from "vitest";
import {
  applyUpdateSuccessMessage,
  backupDownloadUrl,
  clearedUpdateProgress,
  optimisticUpdateRun,
  updateLogFileName,
} from "@/admin-core/src/admin-update-progress";
import { createAdminAppBootstrap } from "@/lib/api/mock/admin-bootstrap";

describe("optimisticUpdateRun", () => {
  const { data } = createAdminAppBootstrap();

  it("keeps an existing phase and current target", () => {
    const current = { from: "0.1.0", to: "0.2.0", at: "earlier" };
    const started = optimisticUpdateRun(
      {
        ...data.updates,
        phase: "extracting",
        current,
        cancelRequested: true,
        lastResult: {
          ok: false,
          version: "0.2.0",
          message: "failed",
          finishedAt: null,
        },
      },
      "2026-09-25T11:00:00.000Z",
      "9.9.9",
    );
    expect(started.inProgress).toBe(true);
    expect(started.phase).toBe("extracting");
    expect(started.current).toBe(current);
    expect(started.cancelRequested).toBe(false);
    expect(started.lastResult).toBeNull();
  });

  it("fills a missing phase and current from the requested version", () => {
    const started = optimisticUpdateRun(
      {
        ...data.updates,
        latest: {
          version: "8.0.0",
          package_url: "",
          checksum_sha256: "",
          checksum_signature: "",
        },
      },
      "2026-09-25T11:00:00.000Z",
      "1.2.3",
    );
    expect(started.phase).toBe("downloading");
    expect(started.current).toEqual({
      from: data.updates.installedVersion,
      to: "1.2.3",
      at: "2026-09-25T11:00:00.000Z",
    });
  });
});

describe("clearedUpdateProgress", () => {
  it("clears in-flight progress and keeps the installed version", () => {
    const { data } = createAdminAppBootstrap();
    const cleared = clearedUpdateProgress({
      ...data.updates,
      inProgress: true,
      phase: "applying_files",
      current: { from: "0.0.0", to: "1.0.0", at: "now" },
      download: { downloadedBytes: 1, totalBytes: 2, percent: 50, updatedAt: "now" },
      phaseProgress: { completed: 1, total: 4, percent: 25, updatedAt: "now" },
      cancelRequested: true,
      cancelAllowed: true,
    });
    expect(cleared.installedVersion).toBe(data.updates.installedVersion);
    expect(cleared).toMatchObject({
      inProgress: false,
      phase: null,
      current: null,
      download: null,
      phaseProgress: null,
      cancelRequested: false,
      cancelAllowed: false,
    });
  });
});

describe("applyUpdateSuccessMessage", () => {
  const { data } = createAdminAppBootstrap();

  it("describes whether a run started, was already running, or finished", () => {
    const running = { ...data.updates, inProgress: true };
    const idle = { ...data.updates, inProgress: false };
    expect(applyUpdateSuccessMessage(running, false)).toBe("Update run started");
    expect(applyUpdateSuccessMessage(running, true)).toBe("Update is already in progress");
    expect(applyUpdateSuccessMessage(idle, false)).toBe("Update request completed");
  });
});

describe("update log and backup names", () => {
  it("builds a colon-free log filename and an encoded backup url", () => {
    expect(updateLogFileName("2026-09-25T11:44:00.000Z")).toBe(
      "update-log-2026-09-25T11-44-00.000Z.log",
    );
    expect(backupDownloadUrl("release 1/backup.zip")).toBe(
      "/api/v1/admin/updates/backups/release%201%2Fbackup.zip",
    );
  });
});
