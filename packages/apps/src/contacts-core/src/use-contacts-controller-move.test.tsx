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
