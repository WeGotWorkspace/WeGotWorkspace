import { afterEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useListSort } from "@/hooks/use-list-sort";

const columns = { date: "desc", title: "asc" } as const;
const KEY = "wgw.test.listSort";

describe("useListSort chooseSort", () => {
  afterEach(() => window.localStorage.removeItem(KEY));

  it("sets an exact order and remembers it for the next visit", () => {
    const args = {
      columns,
      defaultSort: { key: "date", direction: "desc" },
      storageKey: KEY,
    } as const;
    const first = renderHook(() => useListSort(args));
    act(() => first.result.current.chooseSort({ key: "title", direction: "desc" }));
    expect(first.result.current.sort).toEqual({ key: "title", direction: "desc" });
    first.unmount();

    const second = renderHook(() => useListSort(args));
    expect(second.result.current.sort).toEqual({ key: "title", direction: "desc" });
  });

  it("falls back to the default for a stored key that no longer exists", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ key: "gone", direction: "asc" }));
    const { result } = renderHook(() =>
      useListSort({ columns, defaultSort: { key: "date", direction: "desc" }, storageKey: KEY }),
    );
    expect(result.current.sort).toEqual({ key: "date", direction: "desc" });
  });
});
