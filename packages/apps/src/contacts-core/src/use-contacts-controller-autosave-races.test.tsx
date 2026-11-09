/** @vitest-environment jsdom */
import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTACTS_AUTOSAVE_DEBOUNCE_MS } from "./contacts-edit-autosave";
import { contactCardToEditDraft } from "./contacts-edit-utils";
import type { ContactCard } from "./contacts-types";
import {
  advance,
  card,
  clickSelect,
  data,
  fakeOperations,
  holdNextPatch,
  patchedNames,
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

const PAUSE = CONTACTS_AUTOSAVE_DEBOUNCE_MS;
/** Past the undo toast's grace period, so a queued delete or create runs. */
const PAST_UNDO = 10_000;

beforeEach(() => {
  mockShow.mockClear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const savedDraft = (server: Map<string, ContactCard>, id: string) =>
  contactCardToEditDraft(server.get(id)!);

/** Jane's card as another device saved it. */
function remoteJane(change: Partial<ContactCard>): ContactCard {
  return { ...card("card-jane"), etag: '"remote-1"', ...change } as ContactCard;
}

const withJane = (jane: ContactCard) =>
  data.cards.map((row) => (row.id === "card-jane" ? jane : row));

describe("contacts autosave: a change taken back", () => {
  it("saves the name again when a letter is deleted while its save is on its way", async () => {
    const { operations, patchCard, server } = fakeOperations();
    const { result } = renderController(operations);

    clickSelect(result, "card-jane");
    act(() => result.current.updateEditDraft({ nameGiven: "Janex" }));
    const release = holdNextPatch(patchCard);
    await advance(PAUSE);
    expect(patchCard).toHaveBeenCalledOnce();

    act(() => result.current.updateEditDraft({ nameGiven: "Jane" }));
    await advance(PAUSE * 2);
    await release();
    await advance(PAUSE * 2);

    expect(result.current.editDraft?.nameGiven).toBe("Jane");
    expect(savedDraft(server, "card-jane").nameGiven).toBe("Jane");
  });

  it("keeps the deleted letter out when the save's own card arrives before the save returns", async () => {
    const { operations, patchCard, server } = fakeOperations();
    const { result, rerender } = renderController(operations);

    clickSelect(result, "card-jane");
    act(() => result.current.updateEditDraft({ nameGiven: "Janex" }));
    const release = holdNextPatch(patchCard);
    await advance(PAUSE);
    act(() => result.current.updateEditDraft({ nameGiven: "Jane" }));
    // The sync brings the card as the server now holds it, before the save resolves.
    rerender({
      cards: withJane(
        remoteJane({ name: { "@type": "Name", isOrdered: false, full: "Janex Doe" } }),
      ),
    });
    await settle();
    expect(result.current.editDraft?.nameGiven).toBe("Jane");

    await release();
    await advance(PAUSE * 2);
    expect(result.current.editDraft?.nameGiven).toBe("Jane");
    expect(savedDraft(server, "card-jane").nameGiven).toBe("Jane");
  });

  it("drops the waiting save when a letter is deleted within the pause, beside an empty row", async () => {
    const { operations, patchCard } = fakeOperations();
    const { result } = renderController(operations);

    clickSelect(result, "card-jane");
    act(() => {
      result.current.addPhone();
    });
    act(() => result.current.updateEditDraft({ nameGiven: "Janex" }));
    await advance(PAUSE / 4);
    act(() => result.current.updateEditDraft({ nameGiven: "Jane" }));
    await advance(PAUSE * 3);

    expect(patchCard).not.toHaveBeenCalled();
  });
});

describe("contacts autosave: an empty row or a revealed field is not an edit", () => {
  it("takes another device's phone change while an empty phone row is open", async () => {
    const { operations, patchCard } = fakeOperations();
    const { result, rerender } = renderController(operations);

    clickSelect(result, "card-jane");
    act(() => {
      result.current.addPhone();
    });
    const [phoneId] = Object.keys(card("card-jane").phones ?? {});
    rerender({
      cards: withJane(
        remoteJane({
          phones: { [phoneId!]: { "@type": "Phone", number: "+1-555-0199" } },
        } as Partial<ContactCard>),
      ),
    });
    await settle();

    const numbers = result.current.editDraft?.phones.map((row) => row.number);
    expect(numbers).toEqual(["+1-555-0199", ""]);
    await advance(PAUSE * 3);
    expect(patchCard).not.toHaveBeenCalled();
  });

  it("takes a rename from another device after Add field > Middle name", async () => {
    const { operations, patchCard } = fakeOperations();
    const { result, rerender } = renderController(operations);

    clickSelect(result, "card-jane");
    act(() => result.current.updateEditDraft({ showGiven2: true }));
    rerender({
      cards: withJane(
        remoteJane({
          name: { "@type": "Name", isOrdered: false, full: "Janet Doe" },
        } as Partial<ContactCard>),
      ),
    });
    await settle();

    expect(result.current.editDraft?.nameGiven).toBe("Janet");
    expect(result.current.editDraft?.showGiven2).toBe(true);
    await advance(PAUSE * 3);
    expect(patchCard).not.toHaveBeenCalled();
  });
});

describe("contacts autosave: deleting the open contact", () => {
  async function typeThenDeleteThenUndo(waitBeforeUndo: number) {
    const ops = fakeOperations();
    const { result } = renderController(ops.operations);
    clickSelect(result, "card-jane");
    act(() => result.current.updateEditDraft({ nameGiven: "Janet" }));
    act(() => result.current.deleteActive());
    await advance(waitBeforeUndo);
    pressUndo(mockShow);
    await settle();
    return { ...ops, result };
  }

  it.each([
    ["before", PAUSE / 2],
    ["after", PAUSE * 2],
  ])("undo %s the typing pause keeps the typed name and saves it", async (_when, wait) => {
    const { result, patchCard, server } = await typeThenDeleteThenUndo(wait);

    expect(result.current.activeId).toBe("card-jane");
    expect(result.current.editDraft?.nameGiven).toBe("Janet");
    await advance(PAUSE * 2);
    expect(savedDraft(server, "card-jane").nameGiven).toBe("Janet");

    act(() => result.current.updateEditDraft({ notes: "Call back" }));
    await advance(PAUSE * 2);
    const saved = savedDraft(server, "card-jane");
    expect(saved.nameGiven).toBe("Janet");
    expect(saved.notes).toBe("Call back");
    expect(Object.keys(patchCard.mock.calls.at(-1)![1])).toEqual(["notes"]);
  });

  it("undo after the save landed keeps the saved card, not the one from before", async () => {
    const { operations, patchCard, server } = fakeOperations();
    const { result } = renderController(operations);
    clickSelect(result, "card-jane");
    act(() => result.current.updateEditDraft({ nameGiven: "Janet" }));
    const release = holdNextPatch(patchCard);
    await advance(PAUSE);
    act(() => result.current.deleteActive());
    await release();
    pressUndo(mockShow);
    await settle();

    const jane = result.current.cards.find((row) => row.id === "card-jane")!;
    expect(contactCardToEditDraft(jane).nameGiven).toBe("Janet");
    expect(jane.etag).toBe(server.get("card-jane")!.etag);
    expect(result.current.editDraft?.nameGiven).toBe("Janet");

    act(() => result.current.updateEditDraft({ notes: "Call back" }));
    await advance(PAUSE * 2);
    expect(patchCard).toHaveBeenCalledTimes(2);
    expect(Object.keys(patchCard.mock.calls[1]![1])).toEqual(["notes"]);
    expect(savedDraft(server, "card-jane").nameGiven).toBe("Janet");
  });

  it("a delete waits for the save on its way and sends the saved card's etag", async () => {
    const { operations, patchCard, deleteCard } = fakeOperations();
    const { result } = renderController(operations);
    clickSelect(result, "card-jane");
    act(() => result.current.updateEditDraft({ nameGiven: "Janet" }));
    const release = holdNextPatch(patchCard);
    await advance(PAUSE);
    act(() => result.current.deleteActive());
    await advance(PAST_UNDO);
    expect(deleteCard).not.toHaveBeenCalled();

    await release();
    await settle();
    expect(deleteCard).toHaveBeenCalledOnce();
    const [id, opts] = deleteCard.mock.calls[0]! as unknown as [string, { ifMatch?: string }];
    expect(id).toBe("card-jane");
    expect(opts.ifMatch).toBe('"v1"');
  });
});

describe("contacts autosave: creates and failed saves", () => {
  it("keeps typing done during a create when the view changes", async () => {
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
    act(() => result.current.updateEditDraft({ nameSurname: "Lee" }));
    await advance(PAUSE * 2);
    act(() => result.current.selectView(result.current.view));

    await act(async () => {
      releaseCreate();
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });
    await advance(PAUSE * 2);

    expect(patchCard).toHaveBeenCalledOnce();
    expect(patchCard.mock.calls[0]![0]).toBe("card-created");
    expect(patchedNames(patchCard.mock.calls[0]![1])).toEqual(["Ann", "Lee"]);
  });

  it("undo after a finished create closes the created contact", async () => {
    const { operations, deleteCard } = fakeOperations();
    const { result } = renderController(operations);

    act(() => result.current.createContact());
    act(() => result.current.updateEditDraft({ nameGiven: "Ann" }));
    act(() => result.current.saveEdit());
    await advance(PAUSE);
    expect(result.current.activeId).toBe("card-created");

    pressUndo(mockShow);
    await settle();

    expect(result.current.activeId).toBe("");
    expect(result.current.editDraft).toBeNull();
    expect(result.current.cards.some((row) => row.id === "card-created")).toBe(false);
    expect(deleteCard).toHaveBeenCalledWith("card-created", expect.anything());
  });

  it("a failed save does not put back a card older than another device's change", async () => {
    const { operations, patchCard } = fakeOperations();
    let fail: () => void = () => {};
    const failed = new Promise<void>((resolve) => {
      fail = resolve;
    });
    patchCard.mockImplementationOnce(async () => {
      await failed;
      throw new Error("offline");
    });
    const { result, rerender } = renderController(operations);

    clickSelect(result, "card-jane");
    act(() => result.current.updateEditDraft({ nameGiven: "Janet" }));
    await advance(PAUSE);
    expect(patchCard).toHaveBeenCalledOnce();
    rerender({
      cards: withJane(remoteJane({ notes: { n1: { "@type": "Note", note: "Met at the fair" } } })),
    });
    await settle();
    await act(async () => {
      fail();
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });

    const jane = result.current.cards.find((row) => row.id === "card-jane")!;
    expect(contactCardToEditDraft(jane).notes).toBe("Met at the fair");
    expect(result.current.editDraft?.notes).toBe("Met at the fair");
    expect(result.current.editDraft?.nameGiven).toBe("Janet");
  });

  it("keeps the name being sent when another device's change arrives mid-save", async () => {
    const { operations, patchCard, server } = fakeOperations();
    const { result, rerender } = renderController(operations);

    clickSelect(result, "card-jane");
    act(() => result.current.updateEditDraft({ nameGiven: "Janet" }));
    const release = holdNextPatch(patchCard);
    await advance(PAUSE);
    expect(patchCard).toHaveBeenCalledOnce();
    const met = remoteJane({ notes: { n1: { "@type": "Note", note: "Met at the fair" } } });
    server.set("card-jane", met);
    rerender({ cards: withJane(met) });
    await settle();
    expect(result.current.editDraft?.nameGiven).toBe("Janet");
    expect(result.current.editDraft?.notes).toBe("Met at the fair");

    // A second change from that device, still with the old name, before the save returns.
    const called = remoteJane({
      etag: '"remote-2"',
      notes: { n1: { "@type": "Note", note: "Called back" } },
    });
    server.set("card-jane", called);
    rerender({ cards: withJane(called) });
    await settle();
    expect(result.current.editDraft?.nameGiven).toBe("Janet");
    expect(result.current.editDraft?.notes).toBe("Called back");

    await release();
    await advance(PAUSE * 2);
    for (const [, patch] of patchCard.mock.calls) {
      expect(patchedNames(patch)).not.toContain("Jane");
      expect(JSON.stringify(patch)).not.toContain("Met at the fair");
    }
    expect(result.current.editDraft?.nameGiven).toBe("Janet");
    expect(result.current.editDraft?.notes).toBe("Called back");
    expect(savedDraft(server, "card-jane").nameGiven).toBe("Janet");
    expect(savedDraft(server, "card-jane").notes).toBe("Called back");
  });
});
