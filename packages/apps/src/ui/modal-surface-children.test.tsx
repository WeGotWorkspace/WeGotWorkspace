import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DialogFooter, DialogHeader } from "@/ui/dialog";
import { wrapModalSurfaceChildren } from "@/ui/modal-surface-children";

describe("wrapModalSurfaceChildren", () => {
  it("wraps sibling fields in ui-modal-body and leaves header/footer outside", () => {
    render(
      <div data-testid="root">
        {wrapModalSurfaceChildren(
          <>
            <DialogHeader>Title</DialogHeader>
            <input aria-label="Name" />
            <DialogFooter>
              <button type="button">Save</button>
            </DialogFooter>
          </>,
        )}
      </div>,
    );
    const root = screen.getByTestId("root");
    const body = root.querySelector(".ui-modal-body");
    expect(body).toBeTruthy();
    expect(body?.querySelector("input")).toBeTruthy();
    expect(body?.querySelector(".ui-modal-header")).toBeNull();
    expect(body?.querySelector(".ui-modal-footer")).toBeNull();
    expect(root.querySelector(".ui-modal-header")).toBeTruthy();
    expect(root.querySelector(".ui-modal-footer")).toBeTruthy();
  });

  it("clones a wrapping form as ui-modal-form and pins DialogFooter outside the body", () => {
    render(
      <div data-testid="root">
        {wrapModalSurfaceChildren(
          <>
            <DialogHeader>Title</DialogHeader>
            <form>
              <input aria-label="Name" />
              <DialogFooter>
                <button type="submit">Save</button>
              </DialogFooter>
            </form>
          </>,
        )}
      </div>,
    );
    const form = screen.getByTestId("root").querySelector("form");
    expect(form?.className).toMatch(/ui-modal-form/);
    const body = form?.querySelector(".ui-modal-body");
    expect(body?.querySelector("input")).toBeTruthy();
    expect(form?.querySelector(".ui-modal-footer")).toBeTruthy();
    expect(body?.querySelector(".ui-modal-footer")).toBeNull();
  });
});
