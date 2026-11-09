/** @vitest-environment jsdom */
import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTACTS_AUTOSAVE_DEBOUNCE_MS } from "./contacts-edit-autosave";
import type { ContactCard } from "./contacts-types";
import {
  advance,
  card,
  clickSelect,
  data,
  fakeOperations,
  pressUndo,
  renderController,
  settle,
} from "./test-utils/contacts-controller-harness";

const { mockShow } = vi.hoisted(() => ({ mockShow: vi.fn() }));

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({
    show: mockShow,
    showError: vi.fn(),
    showSuccess: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-confirm-dialog", () => ({
  useConfirmDialog: () => ({
    confirmDialog: null,
    requestConfirm: ({ onConfirm }: { onConfirm: () => void }) => onConfirm(),
  }),
}));

vi.mock("@/hooks/use-is-touch", () => ({
  useIsTouch: () => false,
}));

beforeEach(() => {
  mockShow.mockClear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("contacts autosave keeps every draft on its own contact", () => {
  it("undoing a delete reopens the contact with its own fields, not the one opened since", async () => {
    const { operations, patchCard } = fakeOperations();
    const { result } = renderController(operations);

    clickSelect(result, "card-jane");
    act(() => result.current.deleteActive());
    clickSelect(result, "card-joe");
    expect(result.current.editDraft?.nameGiven).toBe("Joe");

    pressUndo(mockShow);
    await settle();

    expect(result.current.activeId).toBe("card-jane");
    expect(result.current.editDraft?.nameGiven).toBe("Jane");
    expect(result.current.editDraft?.organization).toBe("Acme Corp");

    act(() => result.current.updateEditDraft({ nameGiven: "Janet" }));
    await advance(CONTACTS_AUTOSAVE_DEBOUNCE_MS * 2);

    const janeCalls = patchCard.mock.calls.filter(([id]) => id === "card-jane");
    expect(janeCalls).toHaveLength(1);
    // Only the name changes: no phone, e-mail, address or organisation is touched.
    expect(Object.keys(janeCalls[0]![1])).toEqual(["name"]);
  });

  it("writes nothing when going back to a contact that was only looked at", async () => {
    const { operations, patchCard } = fakeOperations();
    const { result } = renderController(operations);

    clickSelect(result, "card-doctor");
    clickSelect(result, "card-joe");
    clickSelect(result, "card-doctor");
    await advance(CONTACTS_AUTOSAVE_DEBOUNCE_MS * 3);
    clickSelect(result, "card-jane");
    clickSelect(result, "card-doctor");
    await advance(CONTACTS_AUTOSAVE_DEBOUNCE_MS * 3);

    expect(patchCard).not.toHaveBeenCalled();
  });

  it("an edit of the given name keeps the title and credential", async () => {
    const { operations, patchCard } = fakeOperations();
    const { result } = renderController(operations);

    clickSelect(result, "card-doctor");
    act(() => result.current.updateEditDraft({ nameGiven: "Janet" }));
    await advance(CONTACTS_AUTOSAVE_DEBOUNCE_MS * 2);

    expect(patchCard).toHaveBeenCalledOnce();
    const kinds = (patchCard.mock.calls[0]![1].name?.components ?? []).map(
      (component) => `${component.kind}:${component.value}`,
    );
    expect(kinds).toEqual([
      "title:Dr.",
      "given:Janet",
      "given2:Q",
      "surname:Doe",
      "credential:PhD",
    ]);
  });

  it("shows a change from another device in the open contact and does not revert it", async () => {
    const { operations, patchCard } = fakeOperations();
    const { result, rerender } = renderController(operations);

    clickSelect(result, "card-jane");
    const remote: ContactCard = {
      ...card("card-jane"),
      etag: '"remote-1"',
      notes: { n1: { "@type": "Note", note: "Met at the fair" } },
    } as ContactCard;
    rerender({ cards: data.cards.map((row) => (row.id === "card-jane" ? remote : row)) });
    await settle();

    expect(result.current.editDraft?.notes).toBe("Met at the fair");

    act(() => result.current.updateEditDraft({ nameGiven: "Janet" }));
    await advance(CONTACTS_AUTOSAVE_DEBOUNCE_MS * 2);

    expect(patchCard).toHaveBeenCalledOnce();
    expect(Object.keys(patchCard.mock.calls[0]![1])).toEqual(["name"]);
  });

  it("keeps unsaved typing when another device changes a different field", async () => {
    const { operations, patchCard } = fakeOperations();
    const { result, rerender } = renderController(operations);

    clickSelect(result, "card-jane");
    act(() => result.current.updateEditDraft({ nameGiven: "Janet" }));
    const remote: ContactCard = {
      ...card("card-jane"),
      etag: '"remote-1"',
      notes: { n1: { "@type": "Note", note: "Met at the fair" } },
    } as ContactCard;
    rerender({ cards: data.cards.map((row) => (row.id === "card-jane" ? remote : row)) });
    await settle();

    expect(result.current.editDraft?.nameGiven).toBe("Janet");
    expect(result.current.editDraft?.notes).toBe("Met at the fair");

    await advance(CONTACTS_AUTOSAVE_DEBOUNCE_MS * 2);
    expect(patchCard).toHaveBeenCalledOnce();
    expect(Object.keys(patchCard.mock.calls[0]![1])).toEqual(["name"]);
  });

  it("saves typing done right after creating a contact onto the created card", async () => {
    const { operations, patchCard, createCard } = fakeOperations();
    let releaseCreate: () => void = () => {};
    const createSent = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    const realCreate = createCard.getMockImplementation()!;
    createCard.mockImplementationOnce(async (body) => {
      await createSent;
      return realCreate(body);
    });
    const { result } = renderController(operations);

    act(() => result.current.createContact());
    act(() => result.current.updateEditDraft({ nameGiven: "Ann" }));
    act(() => result.current.saveEdit());
    await settle();
    expect(result.current.editDraft?.nameGiven).toBe("Ann");

    // The typing pause ends while the create is still on its way: nothing to patch yet.
    act(() => result.current.updateEditDraft({ nameSurname: "Lee" }));
    await advance(5_000);
    expect(createCard).toHaveBeenCalledOnce();
    expect(patchCard).not.toHaveBeenCalled();

    await act(async () => {
      releaseCreate();
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });
    await advance(CONTACTS_AUTOSAVE_DEBOUNCE_MS * 2);

    expect(result.current.activeId).toBe("card-created");
    expect(patchCard).toHaveBeenCalledOnce();
    expect(patchCard.mock.calls[0]![0]).toBe("card-created");
    expect(
      (patchCard.mock.calls[0]![1].name?.components ?? []).map((component) => component.value),
    ).toEqual(["Ann", "Lee"]);
  });

  it("a save that finishes late keeps the newer typing", async () => {
    const { operations, patchCard } = fakeOperations();
    let resolveFirst: () => void = () => {};
    const firstSave = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const realPatch = patchCard.getMockImplementation()!;
    patchCard.mockImplementationOnce(async (id, patch) => {
      await firstSave;
      return realPatch(id, patch);
    });
    const { result } = renderController(operations);

    clickSelect(result, "card-jane");
    act(() => result.current.updateEditDraft({ nameGiven: "First" }));
    await advance(CONTACTS_AUTOSAVE_DEBOUNCE_MS);
    expect(patchCard).toHaveBeenCalledOnce();

    act(() => result.current.updateEditDraft({ nameGiven: "Second" }));
    clickSelect(result, "card-joe");
    await act(async () => {
      resolveFirst();
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });
    clickSelect(result, "card-jane");
    await settle();

    expect(result.current.editDraft?.nameGiven).toBe("Second");
    await advance(CONTACTS_AUTOSAVE_DEBOUNCE_MS * 2);

    const last = patchCard.mock.calls.filter(([id]) => id === "card-jane").at(-1)!;
    expect(last[1].name?.components?.map((component) => component.value)).toContain("Second");
  });

  it("Download saves a pending edit first", async () => {
    const { operations, order } = fakeOperations();
    const createObjectURL = vi.fn(() => "blob:test");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const { result } = renderController(operations);

    clickSelect(result, "card-jane");
    act(() => result.current.updateEditDraft({ nameGiven: "Janet" }));
    act(() => result.current.downloadActive());
    await settle();

    expect(order).toEqual(["patch:card-jane", "download:card-jane"]);
  });
});
