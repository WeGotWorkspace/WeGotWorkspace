import { act, cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DRIVE_FILE_TILE_ID_ATTRIBUTE,
  useDriveTilesInView,
} from "@/drive-core/src/use-drive-tiles-in-view";

type Callback = (entries: Array<{ target: Element; isIntersecting: boolean }>) => void;

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  readonly observed: Element[] = [];

  constructor(
    readonly callback: Callback,
    readonly options: IntersectionObserverInit,
  ) {
    FakeIntersectionObserver.instances.push(this);
  }

  observe(element: Element) {
    this.observed.push(element);
  }

  disconnect() {}

  fire(ids: string[], isIntersecting: boolean) {
    const targets = this.observed.filter((element) =>
      ids.includes(element.getAttribute(DRIVE_FILE_TILE_ID_ATTRIBUTE) ?? ""),
    );
    this.callback(targets.map((target) => ({ target, isIntersecting })));
  }
}

function Grid({
  ids,
  onChange,
}: {
  ids: string[];
  onChange: (ids: ReadonlySet<string> | null) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useDriveTilesInView(ref, onChange);
  return (
    <div ref={ref}>
      {ids.map((id) => (
        <div key={id} {...{ [DRIVE_FILE_TILE_ID_ATTRIBUTE]: id }} />
      ))}
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  FakeIntersectionObserver.instances = [];
});

describe("useDriveTilesInView", () => {
  it("reports the tiles the observer sees, scoped to the scroll root", async () => {
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
    const onChange = vi.fn();
    render(<Grid ids={["a", "b", "c"]} onChange={onChange} />);

    expect(onChange).toHaveBeenLastCalledWith(new Set());
    const observer = FakeIntersectionObserver.instances[0]!;
    expect(observer.observed).toHaveLength(3);
    expect(observer.options.rootMargin).toBe("400px 0px");

    act(() => observer.fire(["a", "b"], true));
    expect(onChange).toHaveBeenLastCalledWith(new Set(["a", "b"]));

    act(() => observer.fire(["a"], false));
    expect(onChange).toHaveBeenLastCalledWith(new Set(["b"]));
  });

  it("observes tiles that render later", async () => {
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
    const onChange = vi.fn();
    const { rerender } = render(<Grid ids={["a"]} onChange={onChange} />);
    rerender(<Grid ids={["a", "b"]} onChange={onChange} />);
    // MutationObserver callbacks run as microtasks.
    await act(async () => {
      await Promise.resolve();
    });
    expect(FakeIntersectionObserver.instances[0]!.observed).toHaveLength(2);
  });

  it("reports null (load every preview) without IntersectionObserver", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const onChange = vi.fn();
    render(<Grid ids={["a"]} onChange={onChange} />);
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});
