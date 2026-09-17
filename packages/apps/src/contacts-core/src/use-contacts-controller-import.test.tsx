import { act, renderHook } from "@testing-library/react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createContactsAppBootstrap } from "@/lib/api/mock/contacts-bootstrap";
import { useContactsController } from "./use-contacts-controller";

const { mockRequestConfirm, mockShow, mockShowError, mockDismiss } = vi.hoisted(() => ({
  mockRequestConfirm: vi.fn(),
  mockShow: vi.fn(),
  mockDismiss: vi.fn(),
  mockShowError: vi.fn(),
}));

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({
    show: mockShow,
    showError: mockShowError,
    showSuccess: vi.fn(),
    dismiss: mockDismiss,
  }),
}));

vi.mock("@/hooks/use-confirm-dialog", () => ({
  useConfirmDialog: () => ({
    confirmDialog: null,
    requestConfirm: mockRequestConfirm,
  }),
}));

vi.mock("@/hooks/use-is-touch", () => ({
  useIsTouch: () => false,
}));

const bootstrap = createContactsAppBootstrap();

function clickSelect(
  result: { current: ReturnType<typeof useContactsController> },
  id: string,
  options: { shiftKey?: boolean } = {},
) {
  act(() => {
    result.current.handleSelect(id, {
      detail: 1,
      metaKey: false,
      ctrlKey: false,
      shiftKey: options.shiftKey ?? false,
    } as ReactMouseEvent);
  });
}

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

describe("useContactsController vCard import", () => {
  beforeEach(() => {
    mockShow.mockClear();
    mockShowError.mockClear();
  });

  it("imports multiple vCard files into the selected book and merges created contacts", async () => {
    const importVcards = vi
      .fn()
      .mockResolvedValueOnce({
        list: [
          {
            ...bootstrap.data.cards[0],
            id: "card-imported-one",
            name: { full: "Imported One" },
          },
        ],
        errors: [],
      })
      .mockResolvedValueOnce({
        list: [
          {
            ...bootstrap.data.cards[1],
            id: "card-imported-two",
            name: { full: "Imported Two" },
          },
        ],
        errors: [],
      });

    const { result } = renderHook(() =>
      useContactsController({
        data: bootstrap.data,
        listLoading: false,
        operations: {
          listAddressBooks: vi.fn(),
          listCards: vi.fn(),
          getCard: vi.fn(),
          createCard: vi.fn(),
          patchCard: vi.fn(),
          deleteCard: vi.fn(),
          importVcards,
        },
      }),
    );

    const files = [
      new File(["BEGIN:VCARD\nFN:One\nEND:VCARD"], "one.vcf"),
      new File(["BEGIN:VCARD\nFN:Two\nEND:VCARD"], "two.vcf"),
    ];

    act(() => {
      result.current.handleImportVcf(fileListOf(...files));
    });

    expect(importVcards).not.toHaveBeenCalled();
    expect(result.current.importDialogOpen).toBe(true);

    await act(async () => {
      result.current.submitImportDialog(result.current.importFiles!, "group-eng");
    });

    expect(importVcards).toHaveBeenCalledTimes(2);
    expect(importVcards).toHaveBeenCalledWith("BEGIN:VCARD\nFN:One\nEND:VCARD", {
      addressBookId: "group-eng",
    });
    expect(importVcards).toHaveBeenCalledWith("BEGIN:VCARD\nFN:Two\nEND:VCARD", {
      addressBookId: "group-eng",
    });
    expect(result.current.cards.some((card) => card.id === "card-imported-one")).toBe(true);
    expect(result.current.cards.some((card) => card.id === "card-imported-two")).toBe(true);
    expect(mockShow).toHaveBeenCalledWith(
      expect.stringContaining("Imported 2 contacts"),
      expect.any(Object),
    );
  });

  it("refreshes the contact list after a successful import", async () => {
    const onRefreshList = vi.fn();
    const importVcards = vi.fn().mockResolvedValue({
      list: [
        {
          ...bootstrap.data.cards[0],
          id: "card-imported-one",
          name: { full: "Imported One" },
        },
      ],
      errors: [],
    });

    const { result } = renderHook(() =>
      useContactsController({
        data: bootstrap.data,
        listLoading: false,
        onRefreshList,
        operations: {
          listAddressBooks: vi.fn(),
          listCards: vi.fn(),
          getCard: vi.fn(),
          createCard: vi.fn(),
          patchCard: vi.fn(),
          deleteCard: vi.fn(),
          importVcards,
        },
      }),
    );

    act(() => {
      result.current.handleImportVcf(
        fileListOf(new File(["BEGIN:VCARD\nFN:One\nEND:VCARD"], "one.vcf")),
      );
    });

    await act(async () => {
      result.current.submitImportDialog(result.current.importFiles!, "default");
    });

    expect(onRefreshList).toHaveBeenCalledTimes(1);
    expect(importVcards).toHaveBeenCalledWith("BEGIN:VCARD\nFN:One\nEND:VCARD", {
      addressBookId: "default",
    });
  });

  it("shows an error when no vCard files are selected", () => {
    const { result } = renderHook(() =>
      useContactsController({
        data: bootstrap.data,
        listLoading: false,
        operations: {
          listAddressBooks: vi.fn(),
          listCards: vi.fn(),
          getCard: vi.fn(),
          createCard: vi.fn(),
          patchCard: vi.fn(),
          deleteCard: vi.fn(),
          importVcards: vi.fn(),
        },
      }),
    );

    act(() => {
      result.current.handleImportVcf(
        fileListOf(new File(["plain"], "notes.txt", { type: "text/plain" })),
      );
    });

    expect(mockShowError).toHaveBeenCalledWith(
      expect.stringContaining("Choose one or more .vcf or .vcard files"),
    );
    expect(result.current.importDialogOpen).toBe(false);
  });
});

describe("useContactsController download", () => {
  let mockCreateObjectURL: ReturnType<typeof vi.fn>;
  let mockRevokeObjectURL: ReturnType<typeof vi.fn>;
  let mockAnchorClick: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    mockCreateObjectURL = vi.fn(() => "blob:mock-url");
    mockRevokeObjectURL = vi.fn();
    mockAnchorClick = vi.fn<() => void>();

    Object.defineProperty(URL, "createObjectURL", { value: mockCreateObjectURL, writable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: mockRevokeObjectURL, writable: true });

    const realCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = realCreateElement(tag);
      if (tag === "a") {
        vi.spyOn(el as HTMLAnchorElement, "click").mockImplementation(mockAnchorClick);
      }
      return el;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("downloadActive calls operations.downloadCardVcf with the active card id and triggers blob download", async () => {
    const downloadCardVcf = vi.fn(() => Promise.resolve("BEGIN:VCARD\r\nEND:VCARD"));
    const { result } = renderHook(() =>
      useContactsController({
        data: bootstrap.data,
        listLoading: false,
        operations: {
          listAddressBooks: vi.fn(),
          listCards: vi.fn(),
          getCard: vi.fn(),
          createCard: vi.fn(),
          patchCard: vi.fn(),
          deleteCard: vi.fn(),
          downloadCardVcf,
        },
      }),
    );

    clickSelect(result, "card-jane");

    await act(async () => {
      result.current.downloadActive();
    });

    expect(downloadCardVcf).toHaveBeenCalledWith("card-jane");
    expect(mockCreateObjectURL).toHaveBeenCalled();
    expect(mockAnchorClick).toHaveBeenCalled();
    expect(mockRevokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });

  it("downloadActive does nothing when no active card is selected", async () => {
    const downloadCardVcf = vi.fn(() => Promise.resolve("BEGIN:VCARD\r\nEND:VCARD"));
    const { result } = renderHook(() =>
      useContactsController({
        data: bootstrap.data,
        listLoading: false,
        operations: {
          listAddressBooks: vi.fn(),
          listCards: vi.fn(),
          getCard: vi.fn(),
          createCard: vi.fn(),
          patchCard: vi.fn(),
          deleteCard: vi.fn(),
          downloadCardVcf,
        },
      }),
    );

    await act(async () => {
      result.current.downloadActive();
    });

    expect(downloadCardVcf).not.toHaveBeenCalled();
  });

  it("downloadSelected calls downloadCardVcf for each selected card and triggers blob download", async () => {
    const downloadCardVcf = vi.fn((id: string) =>
      Promise.resolve(`BEGIN:VCARD\r\nUID:${id}\r\nEND:VCARD`),
    );
    const { result } = renderHook(() =>
      useContactsController({
        data: bootstrap.data,
        listLoading: false,
        operations: {
          listAddressBooks: vi.fn(),
          listCards: vi.fn(),
          getCard: vi.fn(),
          createCard: vi.fn(),
          patchCard: vi.fn(),
          deleteCard: vi.fn(),
          downloadCardVcf,
        },
      }),
    );

    act(() => {
      result.current.enterSelectionFor("card-jane");
    });
    act(() => {
      result.current.handleSelect("card-joe", {
        detail: 1,
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
      } as import("react").MouseEvent);
    });

    await act(async () => {
      result.current.downloadSelected();
    });

    expect(downloadCardVcf).toHaveBeenCalledWith("card-jane");
    expect(downloadCardVcf).toHaveBeenCalledWith("card-joe");
    expect(mockCreateObjectURL).toHaveBeenCalled();
    expect(mockAnchorClick).toHaveBeenCalled();
  });
});
