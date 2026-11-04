import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  DriveUploadBatchDialog,
  driveUploadBatchAnswers,
  driveUploadBatchStepIds,
  type DriveUploadBatchRequest,
} from "@/drive-core/src/drive-upload-batch-dialog";
import type { DriveUploadBatchQuestions } from "@/lib/offline/drive/upload/drive-upload-batch-questions";

const MB = 1024 * 1024;

const space: NonNullable<DriveUploadBatchQuestions["space"]> = {
  status: "does_not_fit",
  quotaId: "dq-root",
  batchBytes: 1400 * MB,
  queuedBytes: 0,
  neededBytes: 1400 * MB,
  freeBytes: 800 * MB,
  measuredAt: Date.UTC(2026, 10, 1, 12),
  fresh: true,
};

const conflicts: NonNullable<DriveUploadBatchQuestions["conflicts"]> = {
  conflicts: [
    {
      itemId: "i1",
      name: "report.pdf",
      existing: { nodeId: "n1", blobId: "b1", hashPending: false },
    },
  ],
  choices: ["replace", "keep_both", "skip"],
  replaceTargets: { i1: { nodeId: "n1", blobId: "b1" } },
};

const keepOffline: NonNullable<DriveUploadBatchQuestions["keepOffline"]> = {
  limitBytes: 8 * MB,
  files: [{ itemId: "i2", name: "movie.mov", size: 20 * MB }],
};

const none: DriveUploadBatchQuestions = { space: null, conflicts: null, keepOffline: null };

function request(questions: Partial<DriveUploadBatchQuestions>): DriveUploadBatchRequest {
  return {
    batchId: "batch-1",
    itemIds: Array.from({ length: 12 }, (_, i) => `i${i}`),
    questions: { ...none, ...questions },
  };
}

describe("driveUploadBatchStepIds", () => {
  it("keeps the order server space, name conflicts, keep offline", () => {
    expect(driveUploadBatchStepIds({ space, conflicts, keepOffline })).toEqual([
      "space",
      "conflicts",
      "keepOffline",
    ]);
    expect(driveUploadBatchStepIds({ ...none, keepOffline, conflicts })).toEqual([
      "conflicts",
      "keepOffline",
    ]);
    expect(driveUploadBatchStepIds(none)).toEqual([]);
  });
});

describe("driveUploadBatchAnswers", () => {
  it("answers only what was asked, with the replace targets for Replace", () => {
    expect(driveUploadBatchAnswers(none, { conflict: "replace", keepOffline: "keep" })).toEqual({
      keepOffline: "remove",
    });
    expect(
      driveUploadBatchAnswers(
        { ...none, conflicts, keepOffline },
        { conflict: "replace", keepOffline: "keep" },
      ),
    ).toEqual({
      keepOffline: "keep",
      conflict: "replace",
      replaceTargets: conflicts.replaceTargets,
    });
    expect(
      driveUploadBatchAnswers({ ...none, conflicts }, { conflict: "skip", keepOffline: "remove" }),
    ).toEqual({ keepOffline: "remove", conflict: "skip" });
  });

  it("never sends Replace when it was not offered", () => {
    const noReplace = { ...conflicts, choices: ["keep_both", "skip"] as const, replaceTargets: {} };
    expect(
      driveUploadBatchAnswers(
        { ...none, conflicts: { ...noReplace, choices: [...noReplace.choices] } },
        {
          conflict: "replace",
          keepOffline: "remove",
        },
      ),
    ).toEqual({ keepOffline: "remove" });
  });
});

describe("folder name step (#1620)", () => {
  const mergeConflicts: NonNullable<DriveUploadBatchQuestions["conflicts"]> = {
    ...conflicts,
    conflicts: [{ ...conflicts.conflicts[0]!, itemId: "in-photos", name: "cover.jpg" }],
  };
  const folders = (canMerge: boolean): NonNullable<DriveUploadBatchQuestions["folders"]> => ({
    folders: [{ itemId: "f1", name: "Photos", keptAsName: "Photos (1)", canMerge }],
    mergeConflicts,
  });

  it("asks only when Merge is possible, before the conflicts step", () => {
    expect(driveUploadBatchStepIds({ ...none, space, folders: folders(true) })).toEqual([
      "space",
      "folders",
    ]);
    expect(driveUploadBatchStepIds({ ...none, folders: folders(false) })).toEqual([]);
  });

  it("follows the file conflicts of the chosen answer", () => {
    const questions = { ...none, folders: folders(true) };
    expect(driveUploadBatchStepIds(questions, "merge")).toEqual(["folders", "conflicts"]);
    expect(
      driveUploadBatchAnswers(questions, {
        conflict: "replace",
        keepOffline: "remove",
        folderConflict: "merge",
      }),
    ).toEqual({
      keepOffline: "remove",
      folderConflict: "merge",
      conflict: "replace",
      replaceTargets: mergeConflicts.replaceTargets,
    });
    // Keep both: the files land in a new folder, so no conflict answer goes out.
    expect(
      driveUploadBatchAnswers(questions, { conflict: "replace", keepOffline: "remove" }),
    ).toEqual({ keepOffline: "remove", folderConflict: "keep_both" });
  });
});

describe("DriveUploadBatchDialog", () => {
  it("walks through every step with Back and Next, then uploads with the answers", async () => {
    const onUpload = vi.fn();
    render(
      <DriveUploadBatchDialog
        request={request({ space, conflicts, keepOffline })}
        onCancel={vi.fn()}
        onUpload={onUpload}
      />,
    );
    const dialog = await screen.findByRole("dialog", { name: "Not enough space on the server" });
    expect(
      within(dialog).getByText("These 12 files need 1.4 GB; the server has 800 MB free."),
    ).toBeTruthy();
    expect(within(dialog).getByText(/emptying the trash helps/)).toBeTruthy();
    const dots = within(dialog).getByRole("list", { name: "Upload steps" });
    expect(within(dots).getByRole("listitem", { current: "step" }).textContent).toBe(
      "Step 1 of 3: Server space",
    );
    await waitFor(() =>
      expect(document.activeElement?.textContent).toBe("Not enough space on the server"),
    );

    fireEvent.click(within(dialog).getByRole("button", { name: "Add anyway" }));
    const conflictsStep = await screen.findByRole("dialog", {
      name: "A file with this name already exists",
    });
    expect(document.activeElement?.textContent).toBe("A file with this name already exists");
    fireEvent.click(within(conflictsStep).getByRole("radio", { name: /Replace/ }));
    fireEvent.click(within(conflictsStep).getByRole("button", { name: "Back" }));
    await screen.findByRole("dialog", { name: "Not enough space on the server" });
    fireEvent.click(screen.getByRole("button", { name: "Add anyway" }));
    // The choice survives going back.
    expect(screen.getByRole("radio", { name: /Replace/ }).getAttribute("aria-checked")).toBe(
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    const keepStep = await screen.findByRole("dialog", { name: "Keep this file on this device?" });
    expect(within(keepStep).getByText(/larger than 8.0 MB/)).toBeTruthy();
    expect(
      within(keepStep)
        .getByRole("radio", { name: /Remove from this device/ })
        .getAttribute("aria-checked"),
    ).toBe("true");
    fireEvent.click(within(keepStep).getByRole("radio", { name: /Keep available offline/ }));
    fireEvent.click(within(keepStep).getByRole("button", { name: "Upload" }));

    expect(onUpload).toHaveBeenCalledWith("batch-1", {
      keepOffline: "keep",
      conflict: "replace",
      replaceTargets: conflicts.replaceTargets,
    });
  });

  it("hides the dots with one step and defaults to Keep both", async () => {
    const onUpload = vi.fn();
    render(
      <DriveUploadBatchDialog
        request={request({ conflicts })}
        onCancel={vi.fn()}
        onUpload={onUpload}
      />,
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("list", { name: "Upload steps" })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Back" })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Upload" }));
    expect(onUpload).toHaveBeenCalledWith("batch-1", {
      keepOffline: "remove",
      conflict: "keep_both",
    });
  });

  it("says offline free space may be out of date", async () => {
    render(
      <DriveUploadBatchDialog
        request={request({ space: { ...space, fresh: false } })}
        onCancel={vi.fn()}
        onUpload={vi.fn()}
      />,
    );
    expect(await screen.findByText(/It may be out of date/)).toBeTruthy();
  });

  it("cancels the whole batch on Escape and on Cancel", async () => {
    const onCancel = vi.fn();
    const { rerender } = render(
      <DriveUploadBatchDialog
        request={request({ keepOffline })}
        onCancel={onCancel}
        onUpload={vi.fn()}
      />,
    );
    await screen.findByRole("dialog");
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledWith("batch-1");

    rerender(
      <DriveUploadBatchDialog
        request={{ ...request({ keepOffline }), batchId: "batch-2" }}
        onCancel={onCancel}
        onUpload={vi.fn()}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenLastCalledWith("batch-2");
  });

  it("shows nothing without a request", () => {
    render(<DriveUploadBatchDialog request={null} onCancel={vi.fn()} onUpload={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
