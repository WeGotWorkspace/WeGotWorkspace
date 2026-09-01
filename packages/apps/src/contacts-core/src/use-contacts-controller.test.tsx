import { act, renderHook } from "@testing-library/react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTACTS_AUTOSAVE_DEBOUNCE_MS } from "./contacts-edit-autosave";
import { createContactsAppBootstrap } from "@/lib/api/mock/contacts-bootstrap";
import { contactsGroupViewKey } from "./contacts-group-utils";
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

describe("useContactsController", () => {
  it("shift-clicks a range in visible list sort order", () => {
    const { result } = renderHook(() =>
      useContactsController({
        data: bootstrap.data,
        listLoading: false,
      }),
    );

    act(() => {
      result.current.selectView("all");
    });

    clickSelect(result, "card-joe");
    clickSelect(result, "card-acme", { shiftKey: true });

    expect(result.current.selectedIds).toEqual(["card-acme", "card-jane", "card-joe"]);
  });

  it("selects a contact and filters the list by search query", () => {
    const { result } = renderHook(() =>
      useContactsController({
        data: bootstrap.data,
        listLoading: false,
      }),
    );

    clickSelect(result, "card-jane");
    expect(result.current.activeId).toBe("card-jane");
    expect(result.current.active?.id).toBe("card-jane");

    act(() => {
      result.current.selectView("all");
    });

    act(() => {
      result.current.setSearchQuery("joe@");
    });
    expect(result.current.visibleCards.map((card) => card.id)).toEqual(["card-joe"]);
  });

  it("preserves in-progress edit draft when switching contacts", () => {
    const { result } = renderHook(() =>
      useContactsController({
        data: bootstrap.data,
        listLoading: false,
      }),
    );

    clickSelect(result, "card-jane");
    act(() => {
      result.current.startEdit();
    });
    act(() => {
      result.current.updateEditDraft({ nameGiven: "Changed Name" });
    });

    clickSelect(result, "card-joe");
    expect(result.current.activeId).toBe("card-joe");
    expect(result.current.editMode).toBe(false);

    clickSelect(result, "card-jane");
    expect(result.current.editMode).toBe(true);
    expect(result.current.editDraft?.nameGiven).toBe("Changed Name");
  });

  it("auto-saves contact edits after debounce", async () => {
    vi.useFakeTimers();
    const patchCard = vi.fn((_id: string) =>
      Promise.resolve({
        ...bootstrap.data.cards.find((card) => card.id === "card-jane")!,
        name: { "@type": "Name" as const, isOrdered: false, full: "Changed Name Doe" },
      }),
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
          patchCard,
          deleteCard: vi.fn(),
        },
      }),
    );

    clickSelect(result, "card-jane");
    act(() => {
      result.current.startEdit();
    });
    act(() => {
      result.current.updateEditDraft({ nameGiven: "Changed Name" });
    });

    await act(async () => {
      vi.advanceTimersByTime(CONTACTS_AUTOSAVE_DEBOUNCE_MS);
      await Promise.resolve();
    });

    expect(patchCard).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("cancel create restores read mode without draft state", () => {
    const { result } = renderHook(() =>
      useContactsController({
        data: bootstrap.data,
        listLoading: false,
      }),
    );

    act(() => {
      result.current.createContact();
    });
    expect(result.current.createMode).toBe(true);
    expect(result.current.editDraft).not.toBeNull();

    act(() => {
      result.current.cancelEdit();
    });

    expect(result.current.createMode).toBe(false);
    expect(result.current.editDraft).toBeNull();
    expect(result.current.activeId).toBe("");
  });

  it("hides group cards from the default address book list", () => {
    const { result } = renderHook(() =>
      useContactsController({
        data: bootstrap.data,
        listLoading: false,
      }),
    );

    expect(result.current.visibleCards.map((card) => card.id)).not.toContain("card-group-friends");
    expect(result.current.visibleCards.map((card) => card.id)).not.toContain("card-group-family");
    expect(result.current.contactGroups.map((card) => card.id)).toEqual([
      "card-group-family",
      "card-group-friends",
    ]);
  });

  it("shows group members when a group sidebar view is selected", () => {
    const { result } = renderHook(() =>
      useContactsController({
        data: bootstrap.data,
        listLoading: false,
      }),
    );

    act(() => {
      result.current.selectView(contactsGroupViewKey("card-group-friends"));
    });

    expect(result.current.viewLabel).toBe("Friends");
    expect(result.current.visibleCards.map((card) => card.id)).toEqual(["card-jane", "card-joe"]);
    expect(result.current.canCreateContact).toBe(true);
    expect(result.current.canImportVcf).toBe(false);
    expect(result.current.selectedGroup?.id).toBe("card-group-friends");
    expect(result.current.canRenameGroup).toBe(true);
  });

  it("disables New when the selected group lives in a view-only book", () => {
    const viewOnlyGroup = {
      ...bootstrap.data.cards.find((card) => card.id === "card-group-friends")!,
      id: "card-group-shared",
      addressBookIds: { "shared-42": true as const },
    };
    const { result } = renderHook(() =>
      useContactsController({
        data: {
          addressBooks: [
            ...bootstrap.data.addressBooks,
            {
              id: "shared-42",
              name: "Alice",
              description: null,
              sortOrder: 2,
              isDefault: false,
              isSubscribed: true,
              isSharee: true,
              shareWith: null,
              myRights: { mayRead: true, mayWrite: false, mayShare: false, mayDelete: true },
            },
          ],
          cards: [...bootstrap.data.cards, viewOnlyGroup],
        },
        listLoading: false,
      }),
    );

    act(() => {
      result.current.selectView(contactsGroupViewKey("card-group-shared"));
    });

    expect(result.current.canCreateContact).toBe(false);
    expect(result.current.canImportVcf).toBe(false);
  });

  it("treats sharee books as shared-N and disables create when mayWrite is false", () => {
    const sharedCard = {
      ...bootstrap.data.cards[0],
      id: "card-shared",
      addressBookIds: { "shared-42": true as const },
    };
    const { result } = renderHook(() =>
      useContactsController({
        data: {
          addressBooks: [
            ...bootstrap.data.addressBooks,
            {
              id: "shared-42",
              name: "Alice",
              description: null,
              sortOrder: 2,
              isDefault: false,
              isSubscribed: true,
              isSharee: true,
              shareWith: null,
              myRights: { mayRead: true, mayWrite: false, mayShare: false, mayDelete: true },
            },
          ],
          cards: [...bootstrap.data.cards, sharedCard],
        },
        listLoading: false,
      }),
    );

    act(() => {
      result.current.selectView("book:shared-42");
    });

    expect(result.current.visibleCards.map((card) => card.id)).toEqual(["card-shared"]);
    expect(result.current.canCreateContact).toBe(false);
    expect(result.current.canEdit).toBe(false);
  });

  it("shows empty member list for group with unresolved members", () => {
    const emptyGroup = {
      "@type": "Card",
      version: "1.0",
      id: "card-group-empty",
      uid: "urn:uuid:550e8400-e29b-41d4-a716-446655440102",
      kind: "group",
      addressBookIds: { default: true },
      name: { full: "Empty Group" },
      members: { "urn:uuid:missing-member": true },
    } as unknown as import("@/contacts-core/src/contacts-types").ContactCard;

    const data = {
      ...bootstrap.data,
      cards: [...bootstrap.data.cards, emptyGroup],
    };

    const { result } = renderHook(() =>
      useContactsController({
        data,
        listLoading: false,
      }),
    );

    act(() => {
      result.current.selectView(contactsGroupViewKey("card-group-empty"));
    });

    expect(result.current.viewLabel).toBe("Empty Group");
    expect(result.current.visibleCards).toEqual([]);
  });

  it("optimistically renames a group in sidebar and list header", () => {
    const { result } = renderHook(() =>
      useContactsController({
        data: bootstrap.data,
        listLoading: false,
      }),
    );

    act(() => {
      result.current.selectView(contactsGroupViewKey("card-group-friends"));
    });

    act(() => {
      result.current.renameGroup("card-group-friends", "Close Friends");
    });

    expect(
      result.current.contactGroups.find((group) => group.id === "card-group-friends")?.name?.full,
    ).toBe("Close Friends");
    expect(result.current.viewLabel).toBe("Close Friends");
  });

  it("queues a single rename toast (no duplicate immediate toast)", () => {
    mockShow.mockClear();
    const { result } = renderHook(() =>
      useContactsController({
        data: bootstrap.data,
        listLoading: false,
      }),
    );

    act(() => {
      result.current.selectView(contactsGroupViewKey("card-group-friends"));
    });

    act(() => {
      result.current.renameGroup("card-group-friends", "Close Friends");
    });

    expect(mockShow).toHaveBeenCalledTimes(1);
    expect(mockShow).toHaveBeenCalledWith(
      expect.stringContaining("Close Friends"),
      expect.objectContaining({
        canUndo: true,
      }),
    );
  });

  it("removeFromGroup optimistically removes a member from the current group", () => {
    const { result } = renderHook(() =>
      useContactsController({
        data: bootstrap.data,
        listLoading: false,
      }),
    );

    act(() => {
      result.current.selectView(contactsGroupViewKey("card-group-friends"));
    });

    expect(result.current.visibleCards.map((c) => c.id)).toContain("card-jane");

    act(() => {
      result.current.removeFromGroup(["card-jane"]);
    });

    const friendsGroup = result.current.cards.find((c) => c.id === "card-group-friends");
    const janeUid = bootstrap.data.cards.find((c) => c.id === "card-jane")?.uid;
    expect(friendsGroup?.members?.[janeUid!]).toBe(false);
  });

  it("removeFromGroup has no effect when not in a group view", () => {
    const { result } = renderHook(() =>
      useContactsController({
        data: bootstrap.data,
        listLoading: false,
      }),
    );

    const cardsBefore = result.current.cards;

    act(() => {
      result.current.removeFromGroup(["card-jane"]);
    });

    expect(result.current.cards).toBe(cardsBefore);
  });

  it("selectionActionButtons uses remove-from-group in group view", () => {
    const { result } = renderHook(() =>
      useContactsController({
        data: bootstrap.data,
        listLoading: false,
      }),
    );

    act(() => {
      result.current.selectView(contactsGroupViewKey("card-group-friends"));
    });

    const buttonLabels = result.current.selectionBarButtons.map((b) => b.label);
    expect(buttonLabels).toContain("Remove from group");
    expect(buttonLabels).not.toContain("Delete");
  });

  it("selectionActionButtons uses delete outside group view", () => {
    const { result } = renderHook(() =>
      useContactsController({
        data: bootstrap.data,
        listLoading: false,
      }),
    );

    const buttonLabels = result.current.selectionBarButtons.map((b) => b.label);
    expect(buttonLabels).toContain("Delete");
    expect(buttonLabels).not.toContain("Remove from group");
  });

  it("openDeleteGroupConfirm opens destructive confirm dialog for the selected group", () => {
    const { result } = renderHook(() =>
      useContactsController({
        data: bootstrap.data,
        listLoading: false,
      }),
    );

    act(() => {
      result.current.selectView(contactsGroupViewKey("card-group-friends"));
    });

    act(() => {
      result.current.openDeleteGroupConfirm("card-group-friends");
    });

    expect(mockRequestConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "destructive",
        title: "Delete group?",
      }),
    );
  });

  it("deleteGroup optimistically removes group card and navigates to all-contacts view", () => {
    const { result } = renderHook(() =>
      useContactsController({
        data: bootstrap.data,
        listLoading: false,
      }),
    );

    act(() => {
      result.current.selectView(contactsGroupViewKey("card-group-friends"));
    });

    expect(result.current.view).toBe(contactsGroupViewKey("card-group-friends"));
    expect(result.current.contactGroups.map((g) => g.id)).toContain("card-group-friends");

    act(() => {
      result.current.deleteGroup("card-group-friends");
    });

    expect(result.current.view).toBe("all");
    expect(result.current.contactGroups.map((g) => g.id)).not.toContain("card-group-friends");
  });

  it("deleteGroup does nothing when given an unknown group id", () => {
    const { result } = renderHook(() =>
      useContactsController({
        data: bootstrap.data,
        listLoading: false,
      }),
    );

    const cardsBefore = result.current.cards;

    act(() => {
      result.current.deleteGroup("card-does-not-exist");
    });

    expect(result.current.cards).toBe(cardsBefore);
  });

  it("canDeleteGroup is true when the selected group has write access", () => {
    const { result } = renderHook(() =>
      useContactsController({
        data: bootstrap.data,
        listLoading: false,
      }),
    );

    act(() => {
      result.current.selectView(contactsGroupViewKey("card-group-friends"));
    });

    expect(result.current.canDeleteGroup).toBe(true);
  });

  it("canDeleteGroup is false when no group is selected", () => {
    const { result } = renderHook(() =>
      useContactsController({
        data: bootstrap.data,
        listLoading: false,
      }),
    );

    expect(result.current.canDeleteGroup).toBe(false);
  });
});

describe("useContactsController group etag refetch", () => {
  const WRITE_QUEUE_MS = 2500;

  afterEach(() => {
    vi.useRealTimers();
  });

  it("addMembersToGroup refetches group etag before patchCard", async () => {
    vi.useFakeTimers();
    const staleEtag = "etag-stale-from-bootstrap";
    const freshEtag = "etag-fresh-from-server";
    const bootstrapGroup = bootstrap.data.cards.find((card) => card.id === "card-group-friends")!;
    const acmeCard = bootstrap.data.cards.find((card) => card.id === "card-acme")!;
    const groupCard = { ...bootstrapGroup, etag: staleEtag };
    const data = {
      ...bootstrap.data,
      cards: bootstrap.data.cards.map((card) =>
        card.id === "card-group-friends" ? groupCard : card,
      ),
    };
    const freshGroup = { ...groupCard, etag: freshEtag };

    const getCard = vi.fn(() => Promise.resolve(freshGroup));
    const patchCard = vi.fn(() =>
      Promise.resolve({
        ...freshGroup,
        members: {
          ...freshGroup.members,
          [acmeCard.uid!]: true as const,
        },
      }),
    );

    const { result } = renderHook(() =>
      useContactsController({
        data,
        listLoading: false,
        operations: {
          listAddressBooks: vi.fn(),
          listCards: vi.fn(),
          getCard,
          createCard: vi.fn(),
          patchCard,
          deleteCard: vi.fn(),
        },
      }),
    );

    act(() => {
      result.current.addMembersToGroup("card-group-friends", ["card-acme"]);
    });

    await act(async () => {
      vi.advanceTimersByTime(WRITE_QUEUE_MS);
      await Promise.resolve();
    });

    expect(getCard).toHaveBeenCalledWith(
      "card-group-friends",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(patchCard).toHaveBeenCalledWith(
      "card-group-friends",
      expect.objectContaining({ members: expect.any(Object) }),
      expect.objectContaining({ ifMatch: freshEtag }),
    );
    expect(patchCard).not.toHaveBeenCalledWith(
      "card-group-friends",
      expect.anything(),
      expect.objectContaining({ ifMatch: staleEtag }),
    );
    expect(getCard.mock.invocationCallOrder[0]).toBeLessThan(patchCard.mock.invocationCallOrder[0]);
  });
});

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

describe("useContactsController keyboard shortcuts", () => {
  let originalPlatform: PropertyDescriptor | undefined;
  let unmountHook: (() => void) | undefined;

  beforeEach(() => {
    originalPlatform = Object.getOwnPropertyDescriptor(navigator, "platform");
    Object.defineProperty(navigator, "platform", {
      value: "MacIntel",
      configurable: true,
      writable: true,
    });
    mockRequestConfirm.mockClear();
  });

  afterEach(() => {
    // Unmount to remove window event listeners and prevent stale handler cross-test pollution.
    unmountHook?.();
    unmountHook = undefined;
    if (originalPlatform) {
      Object.defineProperty(navigator, "platform", originalPlatform);
    }
  });

  it("Backspace triggers delete confirm dialog in all-contacts view", () => {
    const { result, unmount } = renderHook(() =>
      useContactsController({ data: bootstrap.data, listLoading: false }),
    );
    unmountHook = unmount;

    clickSelect(result, "card-jane");

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
    });

    expect(mockRequestConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive" }),
    );
  });

  it("Delete key triggers delete confirm dialog in all-contacts view (cross-platform)", () => {
    Object.defineProperty(navigator, "platform", {
      value: "Win32",
      configurable: true,
      writable: true,
    });

    const { result, unmount } = renderHook(() =>
      useContactsController({ data: bootstrap.data, listLoading: false }),
    );
    unmountHook = unmount;

    clickSelect(result, "card-jane");

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    });

    expect(mockRequestConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive" }),
    );
  });

  it("Backspace in group view removes contact without confirm dialog", () => {
    const { result, unmount } = renderHook(() =>
      useContactsController({ data: bootstrap.data, listLoading: false }),
    );
    unmountHook = unmount;

    act(() => {
      result.current.selectView(contactsGroupViewKey("card-group-friends"));
    });

    clickSelect(result, "card-jane");

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
    });

    expect(mockRequestConfirm).not.toHaveBeenCalled();

    const friendsGroup = result.current.cards.find((c) => c.id === "card-group-friends");
    const janeUid = bootstrap.data.cards.find((c) => c.id === "card-jane")?.uid;
    expect(friendsGroup?.members?.[janeUid!]).toBe(false);
  });

  it("Backspace does nothing when no contact is selected", () => {
    const { unmount } = renderHook(() =>
      useContactsController({ data: bootstrap.data, listLoading: false }),
    );
    unmountHook = unmount;

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
    });

    expect(mockRequestConfirm).not.toHaveBeenCalled();
  });

  it("Cmd+Z triggers undo of queued mutation", () => {
    const { result, unmount } = renderHook(() =>
      useContactsController({ data: bootstrap.data, listLoading: false }),
    );
    unmountHook = unmount;

    // Navigate to group view and select Jane
    act(() => {
      result.current.selectView(contactsGroupViewKey("card-group-friends"));
    });
    clickSelect(result, "card-jane");

    // Remove Jane from group — queues a mutation
    act(() => {
      result.current.removeFromGroup(["card-jane"]);
    });

    const janeUid = bootstrap.data.cards.find((c) => c.id === "card-jane")?.uid;
    const friendsGroupAfterRemove = result.current.cards.find((c) => c.id === "card-group-friends");
    expect(friendsGroupAfterRemove?.members?.[janeUid!]).toBe(false);

    // Undo via Cmd+Z
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true }),
      );
    });

    const friendsGroupAfterUndo = result.current.cards.find((c) => c.id === "card-group-friends");
    expect(friendsGroupAfterUndo?.members?.[janeUid!]).toBe(true);
  });

  describe("URL routing — initialView / initialContactId / onViewChange / onContactChange", () => {
    it("initialView seeds the controller view on mount", () => {
      const groupView = contactsGroupViewKey("card-group-friends");
      const { result, unmount } = renderHook(() =>
        useContactsController({
          data: bootstrap.data,
          listLoading: false,
          initialView: groupView,
        }),
      );
      unmountHook = unmount;
      expect(result.current.view).toBe(groupView);
    });

    it("initialContactId selects the contact on mount", () => {
      const { result, unmount } = renderHook(() =>
        useContactsController({
          data: bootstrap.data,
          listLoading: false,
          initialContactId: "card-jane",
        }),
      );
      unmountHook = unmount;
      expect(result.current.activeId).toBe("card-jane");
      expect(result.current.active?.id).toBe("card-jane");
    });

    it("syncs activeId when initialContactId changes from the URL", () => {
      const { result, rerender, unmount } = renderHook(
        ({ initialContactId }: { initialContactId: string }) =>
          useContactsController({
            data: bootstrap.data,
            listLoading: false,
            initialContactId,
          }),
        { initialProps: { initialContactId: "" } },
      );
      unmountHook = unmount;

      expect(result.current.activeId).toBe("");

      rerender({ initialContactId: "card-jane" });

      expect(result.current.activeId).toBe("card-jane");
      expect(result.current.active?.id).toBe("card-jane");
    });

    it("onViewChange is called when selectView is invoked (not on mount)", () => {
      const onViewChange = vi.fn();
      const { result, unmount } = renderHook(() =>
        useContactsController({ data: bootstrap.data, listLoading: false, onViewChange }),
      );
      unmountHook = unmount;

      expect(onViewChange).not.toHaveBeenCalled();

      act(() => {
        result.current.selectView(contactsGroupViewKey("card-group-friends"));
      });

      expect(onViewChange).toHaveBeenCalledTimes(1);
      expect(onViewChange).toHaveBeenCalledWith(contactsGroupViewKey("card-group-friends"));
    });

    it("onContactChange is called when a contact is selected (not on mount)", () => {
      const onContactChange = vi.fn();
      const { result, unmount } = renderHook(() =>
        useContactsController({ data: bootstrap.data, listLoading: false, onContactChange }),
      );
      unmountHook = unmount;

      expect(onContactChange).not.toHaveBeenCalled();

      clickSelect(result, "card-jane");

      expect(onContactChange).toHaveBeenCalledTimes(1);
      expect(onContactChange).toHaveBeenCalledWith("card-jane");
    });

    it("onContactChange is called with empty string when view changes (contact cleared)", () => {
      const onContactChange = vi.fn();
      const { result, unmount } = renderHook(() =>
        useContactsController({
          data: bootstrap.data,
          listLoading: false,
          initialContactId: "card-jane",
          onContactChange,
        }),
      );
      unmountHook = unmount;

      act(() => {
        result.current.selectView("all");
      });

      const calls = onContactChange.mock.calls.map(([id]) => id);
      expect(calls).toContain("");
    });

    it("onViewChange fires once per view change, not on mount", () => {
      const onViewChange = vi.fn();
      const groupView = contactsGroupViewKey("card-group-friends");
      const { result, unmount } = renderHook(() =>
        useContactsController({
          data: bootstrap.data,
          listLoading: false,
          initialView: groupView,
          onViewChange,
        }),
      );
      unmountHook = unmount;

      expect(onViewChange).not.toHaveBeenCalled();

      act(() => {
        result.current.selectView("all");
      });

      expect(onViewChange).toHaveBeenCalledTimes(1);
      expect(onViewChange).toHaveBeenCalledWith("all");
    });
  });

  it("creates a group card in the picked writable address book", () => {
    const { result } = renderHook(() =>
      useContactsController({
        data: bootstrap.data,
        listLoading: false,
      }),
    );

    expect(result.current.canCreateGroup).toBe(true);

    act(() => {
      result.current.createGroup("Studio", "default");
    });

    const created = result.current.contactGroups.find((group) => group.name?.full === "Studio");
    expect(created?.kind).toBe("group");
    expect(created?.addressBookIds).toEqual({ default: true });
  });

  it("does not create a group in an inbound share", () => {
    const { result } = renderHook(() =>
      useContactsController({
        data: {
          ...bootstrap.data,
          addressBooks: [
            ...bootstrap.data.addressBooks,
            {
              id: "shared-42",
              name: "Alice",
              description: null,
              sortOrder: 2,
              isDefault: false,
              isSubscribed: true,
              isSharee: true,
              shareWith: null,
              myRights: { mayRead: true, mayWrite: true, mayShare: false, mayDelete: true },
            },
          ],
        },
        listLoading: false,
      }),
    );

    const before = result.current.contactGroups.length;
    act(() => {
      result.current.createGroup("Nope", "shared-42");
    });
    expect(result.current.contactGroups).toHaveLength(before);
  });

  describe("address-book move", () => {
    beforeEach(() => {
      mockRequestConfirm.mockClear();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("moves a contact to another book and drops source-book group memberships", async () => {
      vi.useFakeTimers();
      const jane = bootstrap.data.cards.find((card) => card.id === "card-jane")!;
      const friends = bootstrap.data.cards.find((card) => card.id === "card-group-friends")!;
      const family = bootstrap.data.cards.find((card) => card.id === "card-group-family")!;
      const getCard = vi.fn((id: string) =>
        Promise.resolve(bootstrap.data.cards.find((card) => card.id === id)!),
      );
      const patchCard = vi.fn(
        (id: string, patch: { addressBookIds?: unknown; members?: unknown }) => {
          const current = bootstrap.data.cards.find((card) => card.id === id)!;
          return Promise.resolve({
            ...current,
            ...(patch.addressBookIds ? { addressBookIds: { work: true as const } } : {}),
            ...(patch.members ? { members: { ...current.members, ...patch.members } } : {}),
          });
        },
      );

      const { result } = renderHook(() =>
        useContactsController({
          data: bootstrap.data,
          listLoading: false,
          operations: {
            listAddressBooks: vi.fn(),
            listCards: vi.fn(),
            getCard,
            createCard: vi.fn(),
            patchCard,
            deleteCard: vi.fn(),
          },
        }),
      );

      clickSelect(result, "card-jane");
      expect(result.current.canMoveActiveContact).toBe(true);

      act(() => {
        result.current.selectView("book:default");
      });
      clickSelect(result, "card-jane");
      act(() => {
        result.current.moveActiveContactToAddressBook("work");
      });
      expect(mockRequestConfirm).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Move contact?",
          confirmLabel: "Move",
        }),
      );
      act(() => {
        mockRequestConfirm.mock.calls.at(-1)?.[0].onConfirm();
      });

      const moved = result.current.cards.find((card) => card.id === "card-jane");
      const nextFriends = result.current.cards.find((card) => card.id === "card-group-friends");
      const nextFamily = result.current.cards.find((card) => card.id === "card-group-family");
      expect(moved?.addressBookIds).toEqual({ work: true });
      expect(nextFriends?.members?.[jane.uid!]).toBe(false);
      expect(nextFamily?.members?.[jane.uid!]).toBe(false);
      expect(result.current.view).toBe("book:work");
      expect(result.current.activeId).toBe("card-jane");

      await act(async () => {
        vi.advanceTimersByTime(2500);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(patchCard).toHaveBeenCalledWith(
        "card-jane",
        expect.objectContaining({ addressBookIds: { default: false, work: true } }),
        expect.anything(),
      );
      expect(patchCard).toHaveBeenCalledWith(
        friends.id,
        expect.objectContaining({ members: expect.any(Object) }),
        expect.anything(),
      );
      expect(patchCard).toHaveBeenCalledWith(
        family.id,
        expect.objectContaining({ members: expect.any(Object) }),
        expect.anything(),
      );
    });

    it("does not move a group card between address books", () => {
      const { result } = renderHook(() =>
        useContactsController({
          data: bootstrap.data,
          listLoading: false,
          initialContactId: "card-group-friends",
        }),
      );
      expect(result.current.canMoveActiveContact).toBe(false);
      act(() => {
        result.current.moveActiveContactToAddressBook("work");
      });
      expect(mockRequestConfirm).not.toHaveBeenCalled();
      expect(
        result.current.cards.find((card) => card.id === "card-group-friends")?.addressBookIds,
      ).toEqual({ default: true });
    });
  });

  it("hides create-group when only inbound shares are available", () => {
    const { result } = renderHook(() =>
      useContactsController({
        data: {
          addressBooks: [
            {
              id: "shared-42",
              name: "Alice",
              description: null,
              sortOrder: 0,
              isDefault: false,
              isSubscribed: true,
              isSharee: true,
              shareWith: null,
              myRights: { mayRead: true, mayWrite: false, mayShare: false, mayDelete: true },
            },
          ],
          cards: [],
        },
        listLoading: false,
      }),
    );

    expect(result.current.canCreateGroup).toBe(false);
  });
});
