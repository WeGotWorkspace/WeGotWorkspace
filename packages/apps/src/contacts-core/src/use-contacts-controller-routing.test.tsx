import { act, renderHook } from "@testing-library/react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createContactsAppBootstrap } from "@/lib/api/mock/contacts-bootstrap";
import { contactsGroupViewKey } from "./contacts-group-utils";
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

describe("URL routing — initialView / initialContactId / onViewChange / onContactChange", () => {
  let unmountHook: (() => void) | undefined;

  afterEach(() => {
    unmountHook?.();
    unmountHook = undefined;
  });

  it("initialView seeds the controller view on mount", () => {
    const groupView = contactsGroupViewKey("card-group-friends");
    const { result, unmount } = renderHook(() =>
      useContactsController({
        data: bootstrap.data,
        listLoading: false,
        initialView: groupView,
      }),
    );
    unmountHook = unmount;
    expect(result.current.view).toBe(groupView);
  });

  it("initialContactId selects the contact on mount", () => {
    const { result, unmount } = renderHook(() =>
      useContactsController({
        data: bootstrap.data,
        listLoading: false,
        initialContactId: "card-jane",
      }),
    );
    unmountHook = unmount;
    expect(result.current.activeId).toBe("card-jane");
    expect(result.current.active?.id).toBe("card-jane");
  });

  it("syncs activeId when initialContactId changes from the URL", () => {
    const { result, rerender, unmount } = renderHook(
      ({ initialContactId }: { initialContactId: string }) =>
        useContactsController({
          data: bootstrap.data,
          listLoading: false,
          initialContactId,
        }),
      { initialProps: { initialContactId: "" } },
    );
    unmountHook = unmount;

    expect(result.current.activeId).toBe("");

    rerender({ initialContactId: "card-jane" });

    expect(result.current.activeId).toBe("card-jane");
    expect(result.current.active?.id).toBe("card-jane");
  });

  it("onViewChange is called when selectView is invoked (not on mount)", () => {
    const onViewChange = vi.fn();
    const { result, unmount } = renderHook(() =>
      useContactsController({ data: bootstrap.data, listLoading: false, onViewChange }),
    );
    unmountHook = unmount;

    expect(onViewChange).not.toHaveBeenCalled();

    act(() => {
      result.current.selectView(contactsGroupViewKey("card-group-friends"));
    });

    expect(onViewChange).toHaveBeenCalledTimes(1);
    expect(onViewChange).toHaveBeenCalledWith(contactsGroupViewKey("card-group-friends"));
  });

  it("onContactChange is called when a contact is selected (not on mount)", () => {
    const onContactChange = vi.fn();
    const { result, unmount } = renderHook(() =>
      useContactsController({ data: bootstrap.data, listLoading: false, onContactChange }),
    );
    unmountHook = unmount;

    expect(onContactChange).not.toHaveBeenCalled();

    clickSelect(result, "card-jane");

    expect(onContactChange).toHaveBeenCalledTimes(1);
    expect(onContactChange).toHaveBeenCalledWith("card-jane");
  });

  it("onContactChange is called with empty string when view changes (contact cleared)", () => {
    const onContactChange = vi.fn();
    const { result, unmount } = renderHook(() =>
      useContactsController({
        data: bootstrap.data,
        listLoading: false,
        initialContactId: "card-jane",
        onContactChange,
      }),
    );
    unmountHook = unmount;

    act(() => {
      result.current.selectView("all");
    });

    const calls = onContactChange.mock.calls.map(([id]) => id);
    expect(calls).toContain("");
  });

  it("onViewChange fires once per view change, not on mount", () => {
    const onViewChange = vi.fn();
    const groupView = contactsGroupViewKey("card-group-friends");
    const { result, unmount } = renderHook(() =>
      useContactsController({
        data: bootstrap.data,
        listLoading: false,
        initialView: groupView,
        onViewChange,
      }),
    );
    unmountHook = unmount;

    expect(onViewChange).not.toHaveBeenCalled();

    act(() => {
      result.current.selectView("all");
    });

    expect(onViewChange).toHaveBeenCalledTimes(1);
    expect(onViewChange).toHaveBeenCalledWith("all");
  });
});
