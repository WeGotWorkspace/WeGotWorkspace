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

  it("opens an editable contact straight into its editing draft", () => {
    const { result } = renderHook(() =>
      useContactsController({
        data: bootstrap.data,
        listLoading: false,
      }),
    );

    clickSelect(result, "card-jane");
    expect(result.current.editMode).toBe(true);
    expect(result.current.editDraft?.nameGiven).toBe("Jane");
    expect(result.current.editDraft?.nameSurname).toBe("Doe");
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
      result.current.updateEditDraft({ nameGiven: "Changed Name" });
    });

    clickSelect(result, "card-joe");
    expect(result.current.activeId).toBe("card-joe");
    // Joe opens editable too, with his own values, not Jane's draft.
    expect(result.current.editMode).toBe(true);
    expect(result.current.editDraft?.nameGiven).toBe("Joe");

    clickSelect(result, "card-jane");
    expect(result.current.editMode).toBe(true);
    expect(result.current.editDraft?.nameGiven).toBe("Changed Name");
  });

  it("adds an empty phone, e-mail, address and website row and returns each id", () => {
    const { result } = renderHook(() =>
      useContactsController({
        data: bootstrap.data,
        listLoading: false,
      }),
    );

    clickSelect(result, "card-jane");
    const before = result.current.editDraft!;

    let ids: Array<string | undefined> = [];
    act(() => {
      ids = [
        result.current.addPhone(),
        result.current.addEmail(),
        result.current.addAddress(),
        result.current.addUrl(),
      ];
    });

    const [phoneId, emailId, addressId, urlId] = ids;
    expect(ids.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
    const draft = result.current.editDraft!;
    expect(draft.phones).toHaveLength(before.phones.length + 1);
    expect(draft.phones.at(-1)).toMatchObject({ id: phoneId, number: "" });
    expect(draft.emails.at(-1)).toMatchObject({ id: emailId, address: "" });
    expect(draft.addresses.at(-1)).toMatchObject({ id: addressId, street: "" });
    expect(draft.urls.at(-1)).toMatchObject({ id: urlId, uri: "" });
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
      result.current.updateEditDraft({ nameGiven: "Changed Name" });
    });

    await act(async () => {
      vi.advanceTimersByTime(CONTACTS_AUTOSAVE_DEBOUNCE_MS);
      await Promise.resolve();
    });

    expect(patchCard).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("never saves a contact's draft onto the next one opened with the arrow keys", async () => {
    vi.useFakeTimers();
    const jane = bootstrap.data.cards.find((card) => card.id === "card-jane")!;
    const patchCard = vi.fn((_id: string) => Promise.resolve(jane));

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

    act(() => {
      result.current.selectView("all");
    });
    clickSelect(result, "card-jane");
    act(() => {
      result.current.updateEditDraft({ nameGiven: "Changed Name" });
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    });

    expect(result.current.activeId).toBe("card-joe");
    expect(result.current.editDraft?.nameGiven).toBe("Joe");

    await act(async () => {
      vi.advanceTimersByTime(CONTACTS_AUTOSAVE_DEBOUNCE_MS * 3);
      await Promise.resolve();
    });

    // Jane's edit is saved to Jane; Joe, only looked at, is not written at all.
    expect(patchCard.mock.calls.map(([id]) => id)).toEqual(["card-jane"]);
    vi.useRealTimers();
  });

  it("writes nothing when a contact is only opened, or edited and changed back", async () => {
    vi.useFakeTimers();
    const patchCard = vi.fn((_id: string) =>
      Promise.resolve(bootstrap.data.cards.find((card) => card.id === "card-joe")!),
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

    // Joe's stored name is only a full name: the draft would normalise it on save.
    clickSelect(result, "card-joe");
    await act(async () => {
      vi.advanceTimersByTime(CONTACTS_AUTOSAVE_DEBOUNCE_MS * 2);
      await Promise.resolve();
    });
    expect(patchCard).not.toHaveBeenCalled();

    act(() => {
      result.current.updateEditDraft({ nameGiven: "Joey" });
    });
    act(() => {
      result.current.updateEditDraft({ nameGiven: "Joe" });
    });
    await act(async () => {
      vi.advanceTimersByTime(CONTACTS_AUTOSAVE_DEBOUNCE_MS * 2);
      await Promise.resolve();
    });
    expect(patchCard).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("keeps a phone row that was added but not filled in through an autosave", async () => {
    vi.useFakeTimers();
    const jane = bootstrap.data.cards.find((card) => card.id === "card-jane")!;
    const patchCard = vi.fn((_id: string) =>
      Promise.resolve({
        ...jane,
        // The server's answer differs from what was typed, so taking it over shows.
        name: { "@type": "Name" as const, isOrdered: false, full: "Saved Name Doe" },
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
    let phoneId: string | undefined;
    act(() => {
      phoneId = result.current.addPhone();
    });
    act(() => {
      result.current.updateEditDraft({ nameGiven: "Changed Name" });
    });

    await act(async () => {
      vi.advanceTimersByTime(CONTACTS_AUTOSAVE_DEBOUNCE_MS);
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(patchCard).toHaveBeenCalledOnce();
    const phones = result.current.editDraft?.phones ?? [];
    expect(phones.map((row) => row.number)).toEqual(["+1-555-0101", ""]);
    expect(phones.at(-1)?.id).toBe(phoneId);
    expect(result.current.editDraft?.nameGiven).toBe("Saved Name");
    vi.useRealTimers();
  });

  it("does not replace a draft that changed while the autosave was in flight", async () => {
    vi.useFakeTimers();
    const jane = bootstrap.data.cards.find((card) => card.id === "card-jane")!;
    let resolveSave: (card: typeof jane) => void = () => {};
    const patchCard = vi.fn(
      (_id: string) =>
        new Promise<typeof jane>((resolve) => {
          resolveSave = resolve;
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
      result.current.updateEditDraft({ nameGiven: "First" });
    });
    await act(async () => {
      vi.advanceTimersByTime(CONTACTS_AUTOSAVE_DEBOUNCE_MS);
      await Promise.resolve();
    });
    expect(patchCard).toHaveBeenCalledOnce();

    act(() => {
      result.current.updateEditDraft({ nameGiven: "Second" });
    });
    await act(async () => {
      resolveSave({
        ...jane,
        name: { "@type": "Name" as const, isOrdered: false, full: "First Doe" },
      });
      await Promise.resolve();
    });

    expect(result.current.editDraft?.nameGiven).toBe("Second");
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
