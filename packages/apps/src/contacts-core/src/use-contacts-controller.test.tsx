import { act, renderHook } from "@testing-library/react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { CONTACTS_AUTOSAVE_DEBOUNCE_MS } from "./contacts-edit-autosave";
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
});
