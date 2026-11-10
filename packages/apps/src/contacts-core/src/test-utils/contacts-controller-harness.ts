import { act, renderHook } from "@testing-library/react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { vi, type Mock } from "vitest";
import type { AppToastShowOptions } from "@/hooks/use-app-toast";
import { createContactsAppBootstrap } from "@/lib/api/mock/contacts-bootstrap";
import { mergeContactFromPatch } from "@/contacts-core/src/contacts-patch-merge";
import type {
  ContactCard,
  ContactCardCreate,
  ContactCardPatch,
  ContactsAPIOperations,
} from "@/contacts-core/src/contacts-types";
import { useContactsController } from "@/contacts-core/src/use-contacts-controller";

/**
 * Shared harness for the contacts controller autosave tests: the mock address book
 * plus a doctor card, a server stub that applies patches, and act() helpers. The test
 * file mocks the toast, confirm dialog and touch hooks itself (vi.mock is per file).
 */
const bootstrap = createContactsAppBootstrap();

/** A name with a title and a credential (vCard `N:Doe;Jane;Q;Dr.;PhD`). */
export const DOCTOR: ContactCard = {
  "@type": "Card",
  version: "1.0",
  id: "card-doctor",
  uid: "urn:uuid:550e8400-e29b-41d4-a716-446655440090",
  addressBookIds: { default: true as const },
  name: {
    "@type": "Name",
    isOrdered: false,
    full: "Dr. Jane Q Doe, PhD",
    components: [
      { "@type": "NameComponent", kind: "title", value: "Dr." },
      { "@type": "NameComponent", kind: "given", value: "Jane" },
      { "@type": "NameComponent", kind: "given2", value: "Q" },
      { "@type": "NameComponent", kind: "surname", value: "Doe" },
      { "@type": "NameComponent", kind: "credential", value: "PhD" },
    ],
  },
} as unknown as ContactCard;

export const data = { ...bootstrap.data, cards: [...bootstrap.data.cards, DOCTOR] };

export function card(id: string): ContactCard {
  return data.cards.find((row) => row.id === id)!;
}

/** Server stub: applies patches to its own copy of each card and bumps its etag. */
export function fakeOperations() {
  const server = new Map(data.cards.map((row) => [row.id, row]));
  let version = 0;
  const patchCard = vi.fn(async (id: string, patch: ContactCardPatch) => {
    const current = server.get(id);
    if (!current) throw new Error(`no card ${id}`);
    version += 1;
    const next = { ...mergeContactFromPatch(current, patch), etag: `"v${version}"` };
    server.set(id, next);
    return next;
  });
  const createCard = vi.fn(async (body: ContactCardCreate) => {
    const created = {
      "@type": "Card",
      version: "1.0",
      id: "card-created",
      uid: "urn:uuid:550e8400-e29b-41d4-a716-446655440091",
      etag: '"c1"',
      ...body,
    } as ContactCard;
    server.set(created.id, created);
    return created;
  });
  const order: string[] = [];
  const deleteCard = vi.fn(async (id: string) => {
    order.push(`delete:${id}`);
    server.delete(id);
  });
  patchCard.mockImplementation(async (id: string, patch: ContactCardPatch) => {
    order.push(`patch:${id}`);
    const current = server.get(id);
    if (!current) throw new Error(`no card ${id}`);
    version += 1;
    const next = { ...mergeContactFromPatch(current, patch), etag: `"v${version}"` };
    server.set(id, next);
    return next;
  });
  const downloadCardVcf = vi.fn(async (id: string) => {
    order.push(`download:${id}`);
    return "BEGIN:VCARD\nEND:VCARD";
  });
  const operations = {
    listAddressBooks: vi.fn(),
    listCards: vi.fn(),
    getCard: vi.fn(async (id: string) => server.get(id)!),
    createCard,
    patchCard,
    deleteCard,
    downloadCardVcf,
  } as unknown as ContactsAPIOperations;
  return { operations, server, patchCard, createCard, deleteCard, downloadCardVcf, order };
}

type Props = { cards: ContactCard[] };

export function renderController(operations: ContactsAPIOperations) {
  return renderHook(
    ({ cards }: Props) =>
      useContactsController({
        data: { ...data, cards },
        listLoading: false,
        operations,
      }),
    { initialProps: { cards: data.cards } },
  );
}

export type Result = { current: ReturnType<typeof useContactsController> };

export function clickSelect(result: Result, id: string) {
  act(() => {
    result.current.handleSelect(id, {
      detail: 1,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
    } as ReactMouseEvent);
  });
}

export function pressUndo(show: Mock) {
  const options = show.mock.calls
    .map((call) => call[1] as AppToastShowOptions | undefined)
    .filter((option) => option?.canUndo)
    .at(-1);
  if (!options?.onUndo) throw new Error("no undo toast shown");
  act(() => options.onUndo!());
}

export async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

export async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

/** Holds the next patch until the returned function is called, as a slow network does. */
export function holdNextPatch(patchCard: ReturnType<typeof fakeOperations>["patchCard"]) {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const realPatch = patchCard.getMockImplementation()!;
  patchCard.mockImplementationOnce(async (id, patch) => {
    await gate;
    return realPatch(id, patch);
  });
  return async () => {
    await act(async () => {
      release();
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });
  };
}

/** The given names a patch sends, in order. */
export function patchedNames(patch: ContactCardPatch | undefined) {
  return (patch?.name?.components ?? []).map((component) => component.value);
}
