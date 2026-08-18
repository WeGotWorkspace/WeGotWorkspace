import type { FocusEvent, FormEvent, InputHTMLAttributes } from "react";

/** Portaled Radix poppers and native color wells sit outside DialogContent in the DOM. */
export const DIALOG_NESTED_LAYER_ATTR = "data-dialog-nested-layer";
export const DIALOG_NESTED_LAYER_ACTIVE = "active";

/** Native `<input type="color">` UIs blur before the click-through lands on the overlay. */
const NATIVE_COLOR_WELL_DISMISS_GRACE_MS = 300;

type NestedLayerEvent = {
  preventDefault: () => void;
  target: EventTarget | null;
  detail?: { originalEvent?: Event };
};

function eventDomTarget(event: NestedLayerEvent): EventTarget | null {
  return event.detail?.originalEvent?.target ?? event.target;
}

function isNativeColorWell(node: EventTarget | null): boolean {
  return node instanceof HTMLInputElement && node.type === "color";
}

export function shouldPreventDialogDismiss(event: NestedLayerEvent): boolean {
  const target = eventDomTarget(event);
  if (target instanceof Element && target.closest("[data-radix-popper-content-wrapper]")) {
    return true;
  }
  if (isNativeColorWell(target)) {
    return true;
  }
  return Boolean(
    document.querySelector(`[${DIALOG_NESTED_LAYER_ATTR}="${DIALOG_NESTED_LAYER_ACTIVE}"]`),
  );
}

export function preventDialogDismissForNestedLayer(event: NestedLayerEvent): void {
  if (shouldPreventDialogDismiss(event)) {
    event.preventDefault();
  }
}

export function withNestedLayerDismissGuard<E extends NestedLayerEvent>(
  handler?: (event: E) => void,
): (event: E) => void {
  return (event: E) => {
    preventDialogDismissForNestedLayer(event);
    handler?.(event);
  };
}

export function nativeColorWellDismissProps(): Pick<
  InputHTMLAttributes<HTMLInputElement>,
  "onFocus" | "onBlur" | "onInput"
> {
  return {
    onFocus: (event: FocusEvent<HTMLInputElement>) => {
      event.currentTarget.dataset.dialogNestedLayer = DIALOG_NESTED_LAYER_ACTIVE;
    },
    onInput: (event: FormEvent<HTMLInputElement>) => {
      event.currentTarget.dataset.dialogNestedLayer = DIALOG_NESTED_LAYER_ACTIVE;
    },
    onBlur: (event: FocusEvent<HTMLInputElement>) => {
      const well = event.currentTarget;
      window.setTimeout(() => {
        if (document.activeElement !== well) {
          well.dataset.dialogNestedLayer = "idle";
        }
      }, NATIVE_COLOR_WELL_DISMISS_GRACE_MS);
    },
  };
}
