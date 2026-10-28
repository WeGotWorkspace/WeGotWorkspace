import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/ui/dialog";
import { inertOutsideLayer, useInertOutsideLayerRef } from "@/ui/inert-outside-layer";
import { Popover, PopoverAnchor, PopoverContent } from "@/ui/popover";

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

describe("useInertOutsideLayerRef", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  // React detaches and re-attaches a ref that changes identity on every commit,
  // which is what Radix's composed content ref does (#1699).
  it("does not snapshot again when the same layer is detached and re-attached", async () => {
    mount(`<div id="app"></div><div id="layer"></div>`);
    const layer = document.getElementById("layer")!;
    const { result } = renderHook(() => useInertOutsideLayerRef<HTMLElement>(null));

    result.current(layer);
    const popover = document.createElement("div");
    popover.id = "popover";
    document.body.append(popover);
    result.current(null);
    result.current(layer);
    await Promise.resolve();

    expect(document.getElementById("popover")!.hasAttribute("inert")).toBe(false);
    expect(document.getElementById("app")!.hasAttribute("inert")).toBe(true);
  });

  it("releases the outside once the layer is detached for good", async () => {
    mount(`<div id="app"></div><div id="layer"></div>`);
    const { result } = renderHook(() => useInertOutsideLayerRef<HTMLElement>(null));

    result.current(document.getElementById("layer")!);
    result.current(null);
    await Promise.resolve();

    expect(document.getElementById("app")!.hasAttribute("inert")).toBe(false);
  });
});

/** A dialog with a search field whose results open in a popover, like the share dialog. */
function DialogWithSearch({ onPick }: { onPick: (name: string) => void }) {
  const [query, setQuery] = useState("");
  return (
    <Dialog open>
      <DialogContent>
        <DialogTitle>Share</DialogTitle>
        <DialogDescription>Invite teammates.</DialogDescription>
        <Popover open={query.length >= 2} modal={false}>
          <PopoverAnchor asChild>
            <input
              aria-label="Add people"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </PopoverAnchor>
          <PopoverContent onOpenAutoFocus={(event) => event.preventDefault()}>
            <button type="button" onClick={() => onPick("Member")}>
              Member
            </button>
          </PopoverContent>
        </Popover>
      </DialogContent>
    </Dialog>
  );
}

describe("a popover opened inside a dialog", () => {
  it("stays clickable after the dialog re-renders", async () => {
    const onPick = vi.fn();
    render(<DialogWithSearch onPick={onPick} />);
    const input = screen.getByRole("textbox", { name: "Add people" });

    // Opening the popover is one dialog render; the next keystroke is another.
    fireEvent.change(input, { target: { value: "me" } });
    fireEvent.change(input, { target: { value: "mem" } });
    await act(async () => {
      await Promise.resolve();
    });

    const option = screen.getByRole("button", { name: "Member" });
    expect(option.closest("[inert]")).toBeNull();
    fireEvent.click(option);
    expect(onPick).toHaveBeenCalledWith("Member");
  });
});

/** The page behind a dialog, plus the dialog with a search field that re-renders it. */
function PageWithDialog({ open }: { open: boolean }) {
  const [query, setQuery] = useState("");
  return (
    <>
      <button type="button">Behind</button>
      <Dialog open={open}>
        <DialogContent>
          <DialogTitle>Share</DialogTitle>
          <DialogDescription>Invite teammates.</DialogDescription>
          <input aria-label="Add people" value={query} onChange={(e) => setQuery(e.target.value)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

describe("a modal dialog", () => {
  it("keeps the page inert while open and frees it once closed", async () => {
    const { rerender } = render(<PageWithDialog open />);
    fireEvent.change(screen.getByRole("textbox", { name: "Add people" }), {
      target: { value: "me" },
    });
    await act(async () => {
      await Promise.resolve();
    });
    const behind = screen.getByText("Behind", { selector: "button" });
    expect(behind.closest("[inert]")).not.toBeNull();

    rerender(<PageWithDialog open={false} />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(behind.closest("[inert]")).toBeNull();
    expect(document.querySelectorAll("[inert]")).toHaveLength(0);
  });
});
