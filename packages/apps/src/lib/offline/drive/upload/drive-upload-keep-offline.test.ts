import { describe, expect, it } from "vitest";
import { driveUploadKeepOfflineQuestion } from "@/lib/offline/drive/upload/drive-upload-keep-offline";

const MB = 1024 * 1024;

function item(
  id: string,
  name: string,
  size: number,
  extra: { localCopy?: boolean; failed?: boolean } = {},
) {
  return {
    id,
    name,
    size,
    localCopy: extra.localCopy ?? true,
    status: extra.failed ? ("failed" as const) : ("queued" as const),
  };
}

describe("driveUploadKeepOfflineQuestion", () => {
  it("asks only about files larger than the device limit", () => {
    const question = driveUploadKeepOfflineQuestion(
      [item("a", "small.pdf", 2 * MB), item("b", "big.mov", 20 * MB)],
      { contentSyncEnabled: true, maxFileSizeBytes: 8 * MB },
    );
    expect(question).toEqual({
      limitBytes: 8 * MB,
      files: [{ itemId: "b", name: "big.mov", size: 20 * MB }],
    });
  });

  it("asks about every file when offline files are switched off", () => {
    const question = driveUploadKeepOfflineQuestion(
      [item("a", "small.pdf", 1), item("b", "big.mov", 20 * MB)],
      { contentSyncEnabled: false, maxFileSizeBytes: 8 * MB },
    );
    expect(question?.limitBytes).toBeNull();
    expect(question?.files.map((file) => file.itemId)).toEqual(["a", "b"]);
  });

  it("leaves out direct uploads, failed files, and Docs-editable files", () => {
    const question = driveUploadKeepOfflineQuestion(
      [
        item("a", "direct.mov", 20 * MB, { localCopy: false }),
        item("b", "quota.mov", 20 * MB, { failed: true }),
        item("c", "notes.md", 20 * MB),
      ],
      { contentSyncEnabled: true, maxFileSizeBytes: 8 * MB },
    );
    expect(question).toBeNull();
  });

  it("is null when the rule keeps every file on its own", () => {
    expect(
      driveUploadKeepOfflineQuestion([item("a", "a.pdf", MB)], {
        contentSyncEnabled: true,
        maxFileSizeBytes: 8 * MB,
      }),
    ).toBeNull();
  });
});
