import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

/** TipTap/ProseMirror calls this on Text/Range; jsdom does not implement it. */
function emptyClientRect(): DOMRect {
  return {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    toJSON: () => ({}),
  };
}

function emptyClientRectList(): DOMRectList {
  return {
    length: 0,
    item: () => null,
    [Symbol.iterator]: function* () {},
  } as DOMRectList;
}

function stubClientRects(proto: object) {
  const target = proto as {
    getClientRects?: () => DOMRectList;
    getBoundingClientRect?: () => DOMRect;
  };
  if (typeof target.getClientRects !== "function") {
    target.getClientRects = emptyClientRectList;
  }
  if (typeof target.getBoundingClientRect !== "function") {
    target.getBoundingClientRect = emptyClientRect;
  }
}

if (typeof Range !== "undefined") stubClientRects(Range.prototype);
if (typeof Element !== "undefined") stubClientRects(Element.prototype);
if (typeof Text !== "undefined") stubClientRects(Text.prototype);

/**
 * Node's timer, captured before a test installs fake timers.
 * Vitest does not replace global `setTimeout` with jsdom's, so
 * `@radix-ui/react-focus-scope` queues its unmount callback here.
 */
const realSetTimeout = globalThis.setTimeout;

afterEach(async () => {
  cleanup();
  await flushRadixFocusScopeUnmountTimer();
});

/**
 * Focus-scope restores focus from its unmount effect via `setTimeout(0)`,
 * then `new CustomEvent` + `container.dispatchEvent`. jsdom teardown restores
 * Node's `CustomEvent`, so a callback that outlives the file throws an
 * unhandled TypeError (`parameter 1 is not of type 'Event'`). File hooks run
 * first and may unmount there; this setup hook runs last, while this window
 * is still current.
 */
async function flushRadixFocusScopeUnmountTimer() {
  // Do not wrap this in `act`. A leftover React act scope changes when later
  // tests flush promise rejections (optimistic UI never reverts).
  if (vi.isFakeTimers()) {
    await vi.advanceTimersByTimeAsync(0);
  }
  await new Promise<void>((resolve) => {
    realSetTimeout(resolve, 0);
  });
}
