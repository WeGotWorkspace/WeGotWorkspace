import { afterEach, describe, expect, it } from "vitest";
import { inertOutsideLayer } from "@/ui/inert-outside-layer";

function mount(html: string) {
  document.body.innerHTML = html;
}

describe("inertOutsideLayer", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("makes everything outside the layer inert and keeps live regions", () => {
    mount(`
      <div id="app"><button>Behind</button></div>
      <section aria-live="polite" id="toasts"></section>
      <div id="portal"><div id="layer"><button>Inside</button></div><span id="sibling"></span></div>
    `);
    const release = inertOutsideLayer(document.getElementById("layer")!);

    expect(document.getElementById("app")!.hasAttribute("inert")).toBe(true);
    expect(document.getElementById("sibling")!.hasAttribute("inert")).toBe(true);
    expect(document.getElementById("toasts")!.hasAttribute("inert")).toBe(false);
    expect(document.getElementById("portal")!.hasAttribute("inert")).toBe(false);
    expect(document.getElementById("layer")!.hasAttribute("inert")).toBe(false);

    release();
    expect(document.getElementById("app")!.hasAttribute("inert")).toBe(false);
  });

  it("keeps shared siblings inert until the last nested layer closes", () => {
    mount(`<div id="app"></div><div id="outer"></div><div id="inner"></div>`);
    const releaseOuter = inertOutsideLayer(document.getElementById("outer")!);
    const releaseInner = inertOutsideLayer(document.getElementById("inner")!);

    releaseInner();
    expect(document.getElementById("app")!.hasAttribute("inert")).toBe(true);
    releaseOuter();
    expect(document.getElementById("app")!.hasAttribute("inert")).toBe(false);
  });

  it("leaves elements that were already inert as they were", () => {
    mount(`<div id="parked" inert></div><div id="layer"></div>`);
    inertOutsideLayer(document.getElementById("layer")!)();
    expect(document.getElementById("parked")!.hasAttribute("inert")).toBe(true);
  });
});
