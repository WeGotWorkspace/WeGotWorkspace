import { act, renderHook } from "@testing-library/react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
});
