import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useDriveMutations } from "./use-drive-mutations";
import { buildList, buildShell } from "./use-drive-mutations-fixtures";

describe("useDriveMutations star toast undo", () => {
  it("shows exactly one undoable toast when starring a file", () => {
    const setStarred = vi.fn();
    const queueMutation = vi.fn();
    const shell = buildShell({ setStarred });
    const list = buildList({ queueMutation });

    const { result } = renderHook(() => useDriveMutations({ shell, list }));

    act(() => {
      result.current.toggleStar("f-1");
    });

    expect(setStarred).toHaveBeenCalledTimes(1);
    expect(queueMutation).toHaveBeenCalledTimes(1);
    expect(queueMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "drive:star:f-1",
        toastMessage: "Starred",
        undoToastMessage: "Star change undone.",
      }),
    );
  });

  it("undo calls setStarred to revert the star state", () => {
    const setStarred = vi.fn();
    const queueMutation = vi.fn();
    const shell = buildShell({ setStarred, starred: { "f-1": true } });
    const list = buildList({ queueMutation });

    const { result } = renderHook(() => useDriveMutations({ shell, list }));

    act(() => {
      result.current.toggleStar("f-1");
    });

    expect(queueMutation).toHaveBeenCalledTimes(1);
    const mutationConfig = queueMutation.mock.calls[0][0];
    expect(mutationConfig.undo).toBeDefined();

    act(() => {
      mutationConfig.undo();
    });

    expect(setStarred).toHaveBeenCalledTimes(2);
    const lastCall = setStarred.mock.calls[1];
    const updater = lastCall[0];
    const updatedState = updater({ "f-1": false });
    expect(updatedState).toEqual({ "f-1": true });
  });
});
