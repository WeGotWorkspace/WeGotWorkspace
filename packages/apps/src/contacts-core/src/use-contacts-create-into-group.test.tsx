import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createContactsAppBootstrap } from "@/lib/api/mock/contacts-bootstrap";
import { contactsGroupViewKey } from "./contacts-group-utils";
import { useContactsController } from "./use-contacts-controller";

const { mockShow, mockShowError, mockDismiss } = vi.hoisted(() => ({
  mockShow: vi.fn(),
  mockShowError: vi.fn(),
  mockDismiss: vi.fn(),
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
    requestConfirm: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-is-touch", () => ({
  useIsTouch: () => false,
}));

const bootstrap = createContactsAppBootstrap();
const WRITE_QUEUE_MS = 2500;

describe("useContactsController create into group", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates a contact into the selected group book and persists membership", async () => {
    vi.useFakeTimers();
    const createdUid = "urn:uuid:created-new";
    const created = {
      "@type": "Card" as const,
      version: "1.0",
      id: "card-created",
      uid: createdUid,
      addressBookIds: { default: true as const },
      name: { isOrdered: false, components: [{ kind: "given", value: "Pat" }], full: "Pat" },
    };
    const friends = bootstrap.data.cards.find((card) => card.id === "card-group-friends")!;
    const createCard = vi.fn(() => Promise.resolve(created));
    const getCard = vi.fn(() => Promise.resolve(friends));
    const patchCard = vi.fn((_id: string, patch: { members?: Record<string, boolean> }) =>
      Promise.resolve({ ...friends, members: { ...friends.members, ...patch.members } }),
    );

    const { result } = renderHook(() =>
      useContactsController({
        data: bootstrap.data,
        listLoading: false,
        operations: {
          listAddressBooks: vi.fn(),
          listCards: vi.fn(),
          getCard,
          createCard,
          patchCard,
          deleteCard: vi.fn(),
        },
      }),
    );

    act(() => {
      result.current.selectView(contactsGroupViewKey("card-group-friends"));
    });
    act(() => {
      result.current.createContact();
    });
    act(() => {
      result.current.updateEditDraft({ nameGiven: "Pat" });
    });
    act(() => {
      result.current.saveEdit();
    });

    expect(result.current.view).toBe(contactsGroupViewKey("card-group-friends"));
    expect(result.current.createMode).toBe(false);
    expect(result.current.visibleCards.map((card) => card.id)).toContain(result.current.activeId);
    const optimistic = result.current.visibleCards.find(
      (card) => card.id === result.current.activeId,
    );
    expect(optimistic?.addressBookIds).toEqual({ default: true });
    expect(optimistic?.uid && result.current.selectedGroup?.members?.[optimistic.uid]).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(WRITE_QUEUE_MS);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(createCard).toHaveBeenCalledWith(
      expect.objectContaining({ addressBookIds: { default: true } }),
      expect.anything(),
    );
    expect(getCard).toHaveBeenCalledWith("card-group-friends", expect.anything());
    expect(patchCard).toHaveBeenCalledWith(
      "card-group-friends",
      expect.objectContaining({ members: { [createdUid]: true } }),
      expect.anything(),
    );
    expect(result.current.activeId).toBe("card-created");
    expect(result.current.view).toBe(contactsGroupViewKey("card-group-friends"));
    expect(result.current.visibleCards.map((card) => card.id)).toContain("card-created");
  });
});
