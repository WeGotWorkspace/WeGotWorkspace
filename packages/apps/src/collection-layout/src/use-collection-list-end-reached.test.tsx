/** @vitest-environment jsdom */
import { useRef } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CollectionListEnd } from "@/collection-layout/src/collection-list-end";
import {
  COLLECTION_LIST_END_ROOT_MARGIN,
  COLLECTION_LIST_END_THRESHOLD,
  useCollectionListEndReached,
} from "@/collection-layout/src/use-collection-list-end-reached";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

class MockIntersectionObserver {
  static last: MockIntersectionObserver | null = null;
  readonly rootMargin: string;
  readonly threshold: number | number[];

  constructor(
    private callback: IntersectionObserverCallback,
    options?: IntersectionObserverInit,
  ) {
    MockIntersectionObserver.last = this;
    this.rootMargin = options?.rootMargin ?? "";
    this.threshold = options?.threshold ?? 0;
  }

  observe() {}

  disconnect() {}

  emit(isIntersecting: boolean) {
    this.callback([{ isIntersecting } as IntersectionObserverEntry], this as never);
  }
}

function Probe({ enabled, onEndReached }: { enabled: boolean; onEndReached: () => void }) {
  const listEndRef = useRef<HTMLDivElement | null>(null);
  useCollectionListEndReached(listEndRef, enabled, onEndReached);
  return <CollectionListEnd listEndRef={listEndRef} />;
}

describe("useCollectionListEndReached", () => {
  beforeEach(() => {
    MockIntersectionObserver.last = null;
  });

  it("uses Mail's rootMargin and threshold, then fires onEndReached", () => {
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    const onEndReached = vi.fn();
    render(<Probe enabled onEndReached={onEndReached} />);

    expect(MockIntersectionObserver.last?.rootMargin).toBe(COLLECTION_LIST_END_ROOT_MARGIN);
    expect(MockIntersectionObserver.last?.threshold).toBe(COLLECTION_LIST_END_THRESHOLD);
    expect(COLLECTION_LIST_END_ROOT_MARGIN).toBe("180px 0px");
    expect(COLLECTION_LIST_END_THRESHOLD).toBe(0.01);

    MockIntersectionObserver.last?.emit(true);
    expect(onEndReached).toHaveBeenCalledTimes(1);
  });

  it("does not observe when disabled", () => {
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    render(<Probe enabled={false} onEndReached={() => {}} />);
    expect(MockIntersectionObserver.last).toBeNull();
  });
});
