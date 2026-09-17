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

describe("useContactsController group rename", () => {
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
});
