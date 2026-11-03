/** @vitest-environment jsdom */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { driveFilesFromUploadQueue } from "@/drive-core/src/drive-upload-files";
import {
  buildDriveUploadQueueModel,
  DriveUploadQueueProvider,
} from "@/drive-core/src/drive-upload-queue";
import { DriveUploadStatus } from "@/drive-core/src/drive-upload-status";
import { driveUploadStorySnapshot } from "@/drive-core/src/drive-upload-story-fixtures";

afterEach(cleanup);

function statusOf(name: string) {
  const snapshot = driveUploadStorySnapshot();
  const file = driveFilesFromUploadQueue(snapshot, "demo.user").find((f) => f.title === name)!;
  const { container } = render(
    <DriveUploadQueueProvider value={buildDriveUploadQueueModel(snapshot, {})}>
      <DriveUploadStatus file={file} />
    </DriveUploadQueueProvider>,
  );
  return container.querySelector(".drive-upload-status")!;
}

describe("DriveUploadStatus", () => {
  it("keeps the words apart from the percentage, so a phone can show the percentage alone", () => {
    const status = statusOf("Launch video.mp4");
    expect(status.textContent).toBe("Uploading · 45%");
    expect(status.querySelector(".drive-upload-status__words")?.textContent).toBe("Uploading · ");
  });

  it("shows other states as one line", () => {
    const status = statusOf("Scan 0042.png");
    expect(status.textContent).toMatch(/^Upload failed/);
    expect(status.querySelector(".drive-upload-status__words")).toBeNull();
  });
});
