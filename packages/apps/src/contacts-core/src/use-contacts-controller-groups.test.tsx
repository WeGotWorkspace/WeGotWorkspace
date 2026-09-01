import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

describe("useContactsController groups", () => {
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
});
