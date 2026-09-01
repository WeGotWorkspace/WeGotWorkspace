import { act, renderHook } from "@testing-library/react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { createContactsAppBootstrap } from "@/lib/api/mock/contacts-bootstrap";
import type { ContactsUIData } from "./contacts-types";
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

const writableTeamBook = {
  description: null,
  isDefault: false,
  isSubscribed: true,
  isSharee: false,
  shareWith: null,
  myRights: {
    mayRead: true,
    mayWrite: true,
    mayShare: true,
    mayDelete: false,
  },
} as const;

const adminBook = { ...writableTeamBook, id: "group-admin", name: "Admin", sortOrder: 2 };
const administratorsBook = {
  ...writableTeamBook,
  id: "group-administrators",
  name: "Administrators",
  sortOrder: 3,
};

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

describe("useContactsController group tag create", () => {
  it("creates a group from a typed label and adds the selected contact", () => {
    const { result } = renderHook(() =>
      useContactsController({
        data: bootstrap.data,
        listLoading: false,
      }),
    );

    selectContact(result, "card-jane");
    act(() => {
      result.current.addActiveGroupTag("Studio");
    });

    const janeUid = bootstrap.data.cards.find((card) => card.id === "card-jane")?.uid;
    const created = result.current.contactGroups.find((group) => group.name?.full === "Studio");
    expect(created?.kind).toBe("group");
    expect(created?.addressBookIds).toEqual({ default: true });
    expect(created?.members?.[janeUid!]).toBe(true);
  });

  it("rejects tagging a contact onto a group in a different address book", () => {
    const data = {
      addressBooks: [...bootstrap.data.addressBooks, adminBook, administratorsBook],
      cards: [
        ...bootstrap.data.cards,
        {
          "@type": "Card" as const,
          version: "1.0",
          id: "card-admins-lead",
          uid: "urn:uuid:550e8400-e29b-41d4-a716-446655440210",
          kind: "individual" as const,
          addressBookIds: { "group-administrators": true as const },
          name: { "@type": "Name" as const, isOrdered: false, full: "Ada Admin" },
        },
        {
          "@type": "Card" as const,
          version: "1.0",
          id: "card-group-admin",
          uid: "urn:uuid:550e8400-e29b-41d4-a716-446655440200",
          kind: "group" as const,
          addressBookIds: { "group-admin": true as const },
          name: { "@type": "Name" as const, isOrdered: false, full: "Admin leads" },
          members: {},
        },
      ],
    } as ContactsUIData;
    const { result } = renderHook(() =>
      useContactsController({
        data,
        listLoading: false,
      }),
    );

    selectContact(result, "card-admins-lead");
    act(() => {
      result.current.addActiveGroupTag("card-group-admin");
    });

    const adminGroup = result.current.cards.find((card) => card.id === "card-group-admin");
    expect(adminGroup?.members).toEqual({});
  });

  it("creates a typed group in the contact's address book, not the current view book", () => {
    const data = {
      addressBooks: [...bootstrap.data.addressBooks, adminBook, administratorsBook],
      cards: [
        ...bootstrap.data.cards,
        {
          "@type": "Card" as const,
          version: "1.0",
          id: "card-admins-lead",
          uid: "urn:uuid:550e8400-e29b-41d4-a716-446655440211",
          kind: "individual" as const,
          addressBookIds: { "group-administrators": true as const },
          name: { "@type": "Name" as const, isOrdered: false, full: "Ada Admin" },
        },
      ],
    } as ContactsUIData;
    const { result } = renderHook(() =>
      useContactsController({
        data,
        listLoading: false,
      }),
    );

    selectContact(result, "card-admins-lead");
    act(() => {
      result.current.addActiveGroupTag("Studio");
    });

    const created = result.current.contactGroups.find((group) => group.name?.full === "Studio");
    expect(created?.addressBookIds).toEqual({ "group-administrators": true });
    expect(created?.members?.["urn:uuid:550e8400-e29b-41d4-a716-446655440211"]).toBe(true);
  });

  it("addMembersToGroup allows same-book and ignores a cross-book Administrators contact", () => {
    const adminUid = "urn:uuid:550e8400-e29b-41d4-a716-446655440301";
    const administratorsUid = "urn:uuid:550e8400-e29b-41d4-a716-446655440302";
    const { result } = renderHook(() =>
      useContactsController({
        data: {
          addressBooks: [...bootstrap.data.addressBooks, adminBook, administratorsBook],
          cards: [
            ...bootstrap.data.cards,
            {
              "@type": "Card" as const,
              version: "1.0",
              id: "card-group-admin",
              uid: "urn:uuid:550e8400-e29b-41d4-a716-446655440300",
              kind: "group" as const,
              addressBookIds: { "group-admin": true as const },
              name: { "@type": "Name" as const, isOrdered: false, full: "Admin leads" },
              members: {},
            },
            {
              "@type": "Card" as const,
              version: "1.0",
              id: "card-admin-lead",
              uid: adminUid,
              kind: "individual" as const,
              addressBookIds: { "group-admin": true as const },
              name: { "@type": "Name" as const, isOrdered: false, full: "Pat Admin" },
            },
            {
              "@type": "Card" as const,
              version: "1.0",
              id: "card-admins-lead",
              uid: administratorsUid,
              kind: "individual" as const,
              addressBookIds: { "group-administrators": true as const },
              name: { "@type": "Name" as const, isOrdered: false, full: "Ada Administrators" },
            },
          ],
        },
        listLoading: false,
      }),
    );

    act(() => {
      result.current.addMembersToGroup("card-group-admin", ["card-admin-lead"]);
    });
    expect(
      result.current.cards.find((card) => card.id === "card-group-admin")?.members?.[adminUid],
    ).toBe(true);

    act(() => {
      result.current.addMembersToGroup("card-group-admin", ["card-admins-lead"]);
    });
    expect(
      result.current.cards.find((card) => card.id === "card-group-admin")?.members?.[
        administratorsUid
      ],
    ).toBeUndefined();
  });
});
