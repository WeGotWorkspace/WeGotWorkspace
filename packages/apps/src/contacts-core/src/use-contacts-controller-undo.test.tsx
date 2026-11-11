/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppToastShowOptions } from "@/hooks/use-app-toast";
import { createContactsAppBootstrap } from "@/lib/api/mock/contacts-bootstrap";
import type {
  ContactCard,
  ContactCardPatch,
  ContactsAPIOperations,
} from "@/lib/models/contacts-types";
import { useContactsController } from "./use-contacts-controller";

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

const bootstrap = createContactsAppBootstrap();
const FRIENDS = "card-group-friends";
const JANE_UID = "urn:uuid:550e8400-e29b-41d4-a716-446655440010";
const ACME_UID = "urn:uuid:550e8400-e29b-41d4-a716-446655440030";

function cardById(id: string): ContactCard {
  return bootstrap.data.cards.find((card) => card.id === id)!;
}

/** Server stub: applies patches to its own copy of each card, like the real API. */
function fakeOperations(overrides: Partial<ContactsAPIOperations> = {}) {
  const server = new Map(bootstrap.data.cards.map((card) => [card.id, card]));
  const patchCard = vi.fn(async (id: string, patch: ContactCardPatch) => {
    const current = server.get(id)!;
    const next = {
      ...current,
      ...patch,
      members: { ...current.members, ...patch.members },
    } as ContactCard;
    server.set(id, next);
    return next;
  });
  const operations = {
    listAddressBooks: vi.fn(),
    listCards: vi.fn(),
    getCard: vi.fn(async (id: string) => server.get(id)!),
    createCard: vi.fn(),
    patchCard,
    deleteCard: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as ContactsAPIOperations;
  return { operations, server, patchCard };
}

function renderController(operations: ContactsAPIOperations, initialContactId?: string) {
  return renderHook(() =>
    useContactsController({
      data: bootstrap.data,
      listLoading: false,
      operations,
      ...(initialContactId ? { initialContactId } : {}),
    }),
  );
}

function pressUndo() {
  const options = mockShow.mock.calls
    .map((call) => call[1] as AppToastShowOptions | undefined)
    .filter((option) => option?.canUndo)
    .at(-1);
  if (!options?.onUndo) throw new Error("no undo toast shown");
  act(() => options.onUndo!());
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  mockShow.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useContactsController undo as a compensating write", () => {
  it("adds members at once and Undo removes only the members it added", async () => {
    const { operations, server, patchCard } = fakeOperations();
    const { result } = renderController(operations);

    act(() => result.current.addMembersToGroup(FRIENDS, ["card-acme"]));
    await settle();

    expect(patchCard).toHaveBeenCalledWith(
      FRIENDS,
      { members: { [ACME_UID]: true } },
      expect.anything(),
    );

    pressUndo();
    await settle();

    expect(patchCard).toHaveBeenLastCalledWith(
      FRIENDS,
      { members: { [ACME_UID]: false } },
      expect.anything(),
    );
    expect(server.get(FRIENDS)?.members?.[JANE_UID]).toBe(true);
    expect(
      result.current.cards.find((card) => card.id === FRIENDS)?.members?.[ACME_UID],
    ).toBeFalsy();
  });

  it("removes a member at once and Undo adds it back on the group's latest version", async () => {
    const { operations, patchCard } = fakeOperations();
    const { result } = renderController(operations);

    act(() => result.current.removeContactFromGroup(FRIENDS, ["card-jane"]));
    await settle();
    expect(patchCard).toHaveBeenCalledWith(
      FRIENDS,
      { members: { [JANE_UID]: false } },
      expect.anything(),
    );

    pressUndo();
    await settle();

    expect(patchCard).toHaveBeenLastCalledWith(
      FRIENDS,
      { members: { [JANE_UID]: true } },
      expect.anything(),
    );
    // The revert re-reads the group, so it never sends the version from before the write.
    expect(operations.getCard).toHaveBeenCalledTimes(2);
  });

  it("renames a group at once and Undo sends the old name back", async () => {
    const { operations, patchCard } = fakeOperations();
    const { result } = renderController(operations);
    const oldName = cardById(FRIENDS).name;

    act(() => result.current.renameGroup(FRIENDS, "Best friends"));
    await settle();
    expect(patchCard).toHaveBeenCalledWith(
      FRIENDS,
      { name: expect.objectContaining({ full: "Best friends" }) },
      expect.anything(),
    );

    pressUndo();
    await settle();

    expect(patchCard).toHaveBeenLastCalledWith(FRIENDS, { name: oldName }, expect.anything());
    expect(result.current.cards.find((card) => card.id === FRIENDS)?.name).toEqual(oldName);
  });

  it("waits for a create to settle, then deletes the created contact on Undo", async () => {
    let finishCreate: (card: ContactCard) => void = () => undefined;
    const createCard = vi.fn(
      () =>
        new Promise<ContactCard>((resolve) => {
          finishCreate = resolve;
        }),
    );
    const { operations } = fakeOperations({ createCard });
    const { result } = renderController(operations);

    act(() => result.current.createContact());
    act(() => result.current.updateEditDraft({ nameGiven: "Pat" }));
    act(() => result.current.saveEdit());
    expect(createCard).toHaveBeenCalledTimes(1);

    pressUndo();
    await settle();
    expect(operations.deleteCard).not.toHaveBeenCalled();

    finishCreate({ ...cardById("card-jane"), id: "card-created", uid: "urn:uuid:created" });
    await settle();

    expect(operations.deleteCard).toHaveBeenCalledWith("card-created", {});
    // A late answer does not bring the undone contact back on screen.
    expect(result.current.cards.some((card) => card.id === "card-created")).toBe(false);
    expect(result.current.activeId).not.toBe("card-created");
  });

  it("moves a contact back and re-adds the group memberships the move dropped", async () => {
    const { operations, patchCard } = fakeOperations();
    const { result } = renderController(operations, "card-jane");

    act(() => result.current.moveActiveContactToAddressBook("work"));
    await settle();
    expect(patchCard).toHaveBeenCalledWith(
      "card-jane",
      { addressBookIds: { default: false, work: true } },
      expect.anything(),
    );

    pressUndo();
    await settle();

    expect(patchCard).toHaveBeenCalledWith(
      "card-jane",
      { addressBookIds: { work: false, default: true } },
      {},
    );
    expect(patchCard).toHaveBeenCalledWith(
      FRIENDS,
      { members: { [JANE_UID]: true } },
      expect.anything(),
    );
  });

  it("keeps a card delete deferred, and Undo cancels it before it is sent", async () => {
    vi.useFakeTimers();
    const { operations } = fakeOperations();
    const { result } = renderController(operations);

    act(() => result.current.openDeleteConfirm(["card-acme"]));
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(operations.deleteCard).not.toHaveBeenCalled();

    pressUndo();
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(operations.deleteCard).not.toHaveBeenCalled();
    expect(result.current.cards.some((card) => card.id === "card-acme")).toBe(true);
  });

  it("sends a group delete only after the grace period", async () => {
    vi.useFakeTimers();
    const { operations } = fakeOperations();
    const { result } = renderController(operations);

    act(() => result.current.deleteGroup(FRIENDS));
    expect(operations.deleteCard).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(2500);
    });
    expect(operations.deleteCard).toHaveBeenCalledWith(FRIENDS, expect.anything());
  });
});
