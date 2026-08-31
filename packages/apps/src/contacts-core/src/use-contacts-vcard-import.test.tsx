import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultContactsLabels } from "@/contacts-core/src/contacts-labels";
import { useContactsVcardImport } from "@/contacts-core/src/use-contacts-vcard-import";

const toastApi = {
  show: vi.fn(() => "toast-1"),
  showError: vi.fn(),
  showSuccess: vi.fn(),
  dismiss: vi.fn(),
};

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => toastApi,
}));

function fileListOf(...files: File[]): FileList {
  return {
    ...files,
    length: files.length,
    item(index: number) {
      return files[index] ?? null;
    },
    [Symbol.iterator]() {
      return files[Symbol.iterator]();
    },
  } as FileList;
}

describe("useContactsVcardImport", () => {
  beforeEach(() => {
    toastApi.show.mockClear();
    toastApi.showError.mockClear();
  });

  it("opens the dialog without importing until a book is chosen", async () => {
    const importVcards = vi.fn().mockResolvedValue({
      list: [{ id: "card-imported", name: { full: "Imported" } }],
      errors: [],
    });
    const onImported = vi.fn();
    const { result } = renderHook(() =>
      useContactsVcardImport({
        labels: defaultContactsLabels,
        onImported,
        operations: { importVcards },
      }),
    );

    const file = new File(["BEGIN:VCARD\nFN:One\nEND:VCARD"], "one.vcf");
    act(() => {
      result.current.beginImport(fileListOf(file));
    });

    expect(importVcards).not.toHaveBeenCalled();
    expect(result.current.importDialogOpen).toBe(true);
    expect(result.current.importFiles).toHaveLength(1);

    await act(async () => {
      result.current.submitImportDialog(result.current.importFiles!, "group-admin");
    });

    expect(importVcards).toHaveBeenCalledWith("BEGIN:VCARD\nFN:One\nEND:VCARD", {
      addressBookId: "group-admin",
    });
    expect(onImported).toHaveBeenCalled();
    expect(result.current.importDialogOpen).toBe(false);
  });

  it("shows an error when no vCard files are selected", () => {
    const { result } = renderHook(() =>
      useContactsVcardImport({
        labels: defaultContactsLabels,
        operations: { importVcards: vi.fn() },
      }),
    );

    act(() => {
      result.current.beginImport(
        fileListOf(new File(["plain"], "notes.txt", { type: "text/plain" })),
      );
    });

    expect(toastApi.showError).toHaveBeenCalledWith(
      expect.stringContaining("Choose one or more .vcf or .vcard files"),
    );
    expect(result.current.importDialogOpen).toBe(false);
  });

  it("sends the chosen address book id on every chunked batch", async () => {
    const importVcards = vi.fn().mockResolvedValue({
      list: [{ id: "card-imported", name: { full: "Imported" } }],
      errors: [],
    });
    const { result } = renderHook(() =>
      useContactsVcardImport({
        labels: defaultContactsLabels,
        operations: { importVcards },
        maxBatchBytes: 40,
      }),
    );

    const text = ["BEGIN:VCARD\nFN:One\nEND:VCARD", "BEGIN:VCARD\nFN:Two\nEND:VCARD"].join("\n");
    const file = new File([text], "contacts.vcf");
    act(() => {
      result.current.beginImport(fileListOf(file));
    });

    await act(async () => {
      result.current.submitImportDialog(result.current.importFiles!, "group-admin");
    });

    expect(importVcards.mock.calls.length).toBeGreaterThan(1);
    for (const [, opts] of importVcards.mock.calls) {
      expect(opts).toEqual({ addressBookId: "group-admin" });
    }
  });

  it("keeps the dialog open with a clear error when one card cannot be split", async () => {
    const importVcards = vi.fn();
    const { result } = renderHook(() =>
      useContactsVcardImport({
        labels: defaultContactsLabels,
        operations: { importVcards },
        maxBatchBytes: 40,
      }),
    );

    const huge = `BEGIN:VCARD\nFN:Huge\nNOTE:${"x".repeat(80)}\nEND:VCARD`;
    act(() => {
      result.current.beginImport(fileListOf(new File([huge], "photo.vcf")));
    });

    await act(async () => {
      result.current.submitImportDialog(result.current.importFiles!, "default");
    });

    expect(importVcards).not.toHaveBeenCalled();
    expect(result.current.importDialogOpen).toBe(true);
    expect(result.current.importDialogError).toBe(defaultContactsLabels.importCardTooLarge);
    expect(toastApi.showError).toHaveBeenCalledWith(defaultContactsLabels.importCardTooLarge);
  });

  it("shows the API reason instead of a generic import failure", async () => {
    const importVcards = vi
      .fn()
      .mockRejectedValue(new Error("Upload too large. Current server post_max_size is 8M."));
    const { result } = renderHook(() =>
      useContactsVcardImport({
        labels: defaultContactsLabels,
        operations: { importVcards },
      }),
    );

    act(() => {
      result.current.beginImport(
        fileListOf(new File(["BEGIN:VCARD\nFN:One\nEND:VCARD"], "one.vcf")),
      );
    });

    await act(async () => {
      result.current.submitImportDialog(result.current.importFiles!, "default");
    });

    expect(result.current.importDialogOpen).toBe(true);
    expect(result.current.importDialogError).toBe(
      "Upload too large. Current server post_max_size is 8M.",
    );
    expect(toastApi.showError).toHaveBeenCalledWith(
      "Upload too large. Current server post_max_size is 8M.",
    );
    expect(toastApi.showError).not.toHaveBeenCalledWith(defaultContactsLabels.importFailed);
  });
});
