import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("useContactsController group actions", () => {
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
