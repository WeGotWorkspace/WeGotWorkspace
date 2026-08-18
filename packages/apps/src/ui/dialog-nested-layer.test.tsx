import { describe, expect, it, vi } from "vitest";
import {
  DIALOG_NESTED_LAYER_ACTIVE,
  DIALOG_NESTED_LAYER_ATTR,
  preventDialogDismissForNestedLayer,
  shouldPreventDialogDismiss,
} from "@/ui/dialog-nested-layer";

describe("dialog nested layer dismiss", () => {
  it("treats Radix popper content as inside the dialog", () => {
    const popper = document.createElement("div");
    popper.setAttribute("data-radix-popper-content-wrapper", "");
    const target = document.createElement("button");
    popper.append(target);
    document.body.append(popper);

    const event = { preventDefault: vi.fn(), target };
    expect(shouldPreventDialogDismiss(event)).toBe(true);
    preventDialogDismissForNestedLayer(event);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);

    popper.remove();
  });

  it("treats an active native color well as inside the dialog", () => {
    const well = document.createElement("input");
    well.type = "color";
    well.setAttribute(DIALOG_NESTED_LAYER_ATTR, DIALOG_NESTED_LAYER_ACTIVE);
    document.body.append(well);

    const event = { preventDefault: vi.fn(), target: document.documentElement };
    expect(shouldPreventDialogDismiss(event)).toBe(true);

    well.remove();
  });

  it("does not block overlay dismiss when no nested layer is active", () => {
    const event = { preventDefault: vi.fn(), target: document.documentElement };
    expect(shouldPreventDialogDismiss(event)).toBe(false);
    preventDialogDismissForNestedLayer(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
