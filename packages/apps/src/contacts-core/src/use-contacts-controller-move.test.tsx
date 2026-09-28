import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

const inboundShareBook = {
  id: "shared-42",
  name: "Alice",
  description: null,
  sortOrder: 2,
  isDefault: false,
  isSubscribed: true,
  isSharee: true,
  shareWith: null,
  myRights: { mayRead: true, mayWrite: true, mayShare: false, mayDelete: true },
};

const dataWithInboundShare = {
  ...bootstrap.data,
  addressBooks: [...bootstrap.data.addressBooks, inboundShareBook],
};

const inboundShareOnlyData = {
  addressBooks: [
    {
      ...inboundShareBook,
      sortOrder: 0,
      myRights: { mayRead: true, mayWrite: false, mayShare: false, mayDelete: true },
    },
  ],
  cards: [],
};

describe("useContactsController create and move", () => {
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

  it("keeps create, edit, and delete closed while a cold download is in progress", () => {
    const { result } = renderHook(() =>
      useContactsController({
        data: bootstrap.data,
        listLoading: false,
        mutationsLocked: true,
        initialContactId: "card-jane",
      }),
    );

    expect(result.current.canCreateContact).toBe(false);
    expect(result.current.canCreateGroup).toBe(false);
    expect(result.current.canEdit).toBe(false);

    act(() => {
      result.current.createContact();
      result.current.createGroup("Studio", "default");
      result.current.openDeleteConfirm(["card-jane"]);
    });

    expect(result.current.createMode).toBe(false);
    expect(
      result.current.contactGroups.find((group) => group.name?.full === "Studio"),
    ).toBeUndefined();
    expect(result.current.cards.some((row) => row.id === "card-jane")).toBe(true);
    expect(mockRequestConfirm).not.toHaveBeenCalled();
  });

  it("does not create a group in an inbound share", () => {
    const { result } = renderHook(() =>
      useContactsController({
        data: dataWithInboundShare,
        listLoading: false,
      }),
    );

    const before = result.current.contactGroups.length;
    act(() => {
      result.current.createGroup("Nope", "shared-42");
    });
    expect(result.current.contactGroups).toHaveLength(before);
  });

  it("hides create-group when only inbound shares are available", () => {
    const { result } = renderHook(() =>
      useContactsController({
        data: inboundShareOnlyData,
        listLoading: false,
      }),
    );

    expect(result.current.canCreateGroup).toBe(false);
  });
});
