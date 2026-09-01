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
