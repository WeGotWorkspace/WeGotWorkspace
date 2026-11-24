import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createContactsAppBootstrap } from "@/lib/api/mock/contacts-bootstrap";
import type { ContactsAPIOperations } from "@/lib/models/contacts-types";
import { useContactsController } from "./use-contacts-controller";

const { showError } = vi.hoisted(() => ({ showError: vi.fn() }));

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({
    show: vi.fn(),
    showError,
    showSuccess: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-confirm-dialog", () => ({
  useConfirmDialog: () => ({ confirmDialog: null, requestConfirm: vi.fn() }),
}));

vi.mock("@/hooks/use-is-touch", () => ({ useIsTouch: () => false }));

const bootstrap = createContactsAppBootstrap();

function operations(getCard: ContactsAPIOperations["getCard"]): ContactsAPIOperations {
  return { getCard } as unknown as ContactsAPIOperations;
}

describe("useContactsController with partial cards (lean first download)", () => {
  it("keeps an opened partial card read-only and fetches its whole card at once", () => {
    const getCard = vi.fn(async () => bootstrap.data.cards[0]!);
    const { result } = renderHook(() =>
      useContactsController({
        data: bootstrap.data,
        listLoading: false,
        initialContactId: "card-jane",
        partialCardIds: ["card-jane"],
        operations: operations(getCard),
      }),
    );

    expect(result.current.activeIsPartial).toBe(true);
    expect(result.current.canEdit).toBe(false);
    expect(getCard).toHaveBeenCalledTimes(1);
    expect(getCard).toHaveBeenCalledWith("card-jane");

    act(() => {
      result.current.startEdit();
    });
    expect(result.current.editMode).toBe(false);
  });

  it("opens a card that is not partial as before, with no fetch", () => {
    const getCard = vi.fn(async () => bootstrap.data.cards[0]!);
    const { result } = renderHook(() =>
      useContactsController({
        data: bootstrap.data,
        listLoading: false,
        initialContactId: "card-jane",
        partialCardIds: ["card-joe"],
        operations: operations(getCard),
      }),
    );

    expect(result.current.activeIsPartial).toBe(false);
    expect(result.current.canEdit).toBe(true);
    expect(getCard).not.toHaveBeenCalled();
  });

  it("becomes editable once the card is no longer listed as partial", () => {
    const getCard = vi.fn(async () => bootstrap.data.cards[0]!);
    const { result, rerender } = renderHook(
      ({ partial }: { partial: string[] }) =>
        useContactsController({
          data: bootstrap.data,
          listLoading: false,
          initialContactId: "card-jane",
          partialCardIds: partial,
          operations: operations(getCard),
        }),
      { initialProps: { partial: ["card-jane"] } },
    );
    expect(result.current.canEdit).toBe(false);

    rerender({ partial: [] });

    expect(result.current.canEdit).toBe(true);
    expect(getCard).toHaveBeenCalledTimes(1);
  });

  it("a failed fetch leaves the card read-only without an unhandled error", async () => {
    const getCard = vi.fn(async () => {
      throw new Error("offline");
    });
    const { result } = renderHook(() =>
      useContactsController({
        data: bootstrap.data,
        listLoading: false,
        initialContactId: "card-jane",
        partialCardIds: ["card-jane"],
        operations: operations(getCard),
      }),
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.canEdit).toBe(false);
  });

  describe("exporting partial cards", () => {
    function render(extra: {
      mutationsLocked?: boolean;
      downloadCardVcf?: ContactsAPIOperations["downloadCardVcf"];
    }) {
      const ops = {
        getCard: vi.fn(async () => bootstrap.data.cards[0]!),
        downloadCardVcf: extra.downloadCardVcf,
      } as unknown as ContactsAPIOperations;
      return renderHook(() =>
        useContactsController({
          data: bootstrap.data,
          listLoading: false,
          initialContactId: "card-jane",
          partialCardIds: ["card-jane"],
          mutationsLocked: extra.mutationsLocked,
          operations: ops,
        }),
      );
    }

    it("leaves a partial card to downloadCardVcf", async () => {
      showError.mockClear();
      const downloadCardVcf = vi.fn(async () => "BEGIN:VCARD\r\nEND:VCARD");
      const { result } = render({ downloadCardVcf });
      Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
      await act(async () => {
        await result.current.downloadActive();
      });
      expect(downloadCardVcf).toHaveBeenCalledWith("card-jane");
      expect(showError).not.toHaveBeenCalled();
    });

    it("refuses the export while mutations are locked", async () => {
      showError.mockClear();
      const downloadCardVcf = vi.fn(async () => "x");
      const { result } = render({ downloadCardVcf, mutationsLocked: true });
      await act(async () => {
        await result.current.downloadActive();
      });
      expect(downloadCardVcf).not.toHaveBeenCalled();
      expect(showError).toHaveBeenCalledTimes(1);
    });

    it("shows the error without an unhandled rejection when downloadCardVcf rejects", async () => {
      showError.mockClear();
      const downloadCardVcf = vi.fn(async () => {
        throw new Error("offline");
      });
      const { result } = render({ downloadCardVcf });
      await act(async () => {
        await result.current.downloadActive();
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(showError).toHaveBeenCalledTimes(1);
    });
  });
});
