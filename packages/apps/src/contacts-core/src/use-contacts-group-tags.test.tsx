import { act, renderHook } from "@testing-library/react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { createContactsAppBootstrap } from "@/lib/api/mock/contacts-bootstrap";
import { useContactsController } from "./use-contacts-controller";

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({
    show: vi.fn(),
    showError: vi.fn(),
    showSuccess: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-confirm-dialog", () => ({
  useConfirmDialog: () => ({
    confirmDialog: null,
    requestConfirm: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-is-touch", () => ({
  useIsTouch: () => false,
}));

const bootstrap = createContactsAppBootstrap();

function selectContact(
  result: { current: ReturnType<typeof useContactsController> },
  id: string,
): void {
  act(() => {
    result.current.handleSelect(id, {
      detail: 1,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
    } as ReactMouseEvent);
  });
}

describe("useContactsController group tags", () => {
  it("adds the selected contact to an existing group", () => {
    const { result } = renderHook(() =>
      useContactsController({
        data: bootstrap.data,
        listLoading: false,
      }),
    );

    selectContact(result, "card-acme");
    act(() => {
      result.current.addActiveGroupTag("card-group-friends");
    });

    const acmeUid = bootstrap.data.cards.find((card) => card.id === "card-acme")?.uid;
    const friends = result.current.cards.find((card) => card.id === "card-group-friends");
    expect(friends?.members?.[acmeUid!]).toBe(true);
  });

  it("keeps an optimistic group member when a stale bootstrap refresh arrives", () => {
    const { result, rerender } = renderHook(
      ({ data }: { data: typeof bootstrap.data }) =>
        useContactsController({
          data,
          listLoading: false,
        }),
      { initialProps: { data: bootstrap.data } },
    );

    selectContact(result, "card-acme");
    act(() => {
      result.current.addActiveGroupTag("card-group-friends");
    });
    const acmeUid = bootstrap.data.cards.find((card) => card.id === "card-acme")?.uid;
    expect(
      result.current.cards.find((card) => card.id === "card-group-friends")?.members?.[acmeUid!],
    ).toBe(true);

    rerender({
      data: {
        ...bootstrap.data,
        cards: bootstrap.data.cards.map((card) => ({ ...card })),
      },
    });

    expect(
      result.current.cards.find((card) => card.id === "card-group-friends")?.members?.[acmeUid!],
    ).toBe(true);
  });

  it("removes the selected contact from a group without leaving the card", () => {
    const { result } = renderHook(() =>
      useContactsController({
        data: bootstrap.data,
        listLoading: false,
      }),
    );

    selectContact(result, "card-jane");
    act(() => {
      result.current.removeActiveGroupTag("card-group-friends");
    });

    const janeUid = bootstrap.data.cards.find((card) => card.id === "card-jane")?.uid;
    const friends = result.current.cards.find((card) => card.id === "card-group-friends");
    expect(friends?.members?.[janeUid!]).toBe(false);
    expect(result.current.activeId).toBe("card-jane");
  });
});
