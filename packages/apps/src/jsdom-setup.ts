import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

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

afterEach(() => {
  cleanup();
});
