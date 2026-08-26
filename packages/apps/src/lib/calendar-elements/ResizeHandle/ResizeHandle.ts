import { html, unsafeCSS } from "lit";
import { customElement, property } from "lit/decorators.js";
import { BaseElement } from "../BaseElement/BaseElement";
import componentStyle from "./ResizeHandle.css?inline";

/** True when this event is selected and should show coarse-pointer resize handles. */
export function isTouchResizeHandleActive(
  eventKey: unknown,
  selectedEventKey: string | null | undefined,
): boolean {
  if (!selectedEventKey || eventKey == null || eventKey === "") return false;
  return String(eventKey) === selectedEventKey;
}

/**
 * Mount `<resize-handle>` only for the selected event, the hovered event (fine pointer),
 * or the event currently being resized. Idle cards stay handle-free so dense month
 * grids do not pay two Lit custom elements per occurrence.
 */
export function shouldMountResizeHandles(input: {
  resizeHandlesEnabled: boolean;
  eventKey: unknown;
  selectedEventKey: string;
  eventIndex: number;
  hoveredEventIndex: number;
  resizingEventIndex: number;
}): boolean {
  if (!input.resizeHandlesEnabled) return false;
  if (input.eventIndex === input.resizingEventIndex) return true;
  if (input.eventIndex === input.hoveredEventIndex) return true;
  return isTouchResizeHandleActive(input.eventKey, input.selectedEventKey);
}

@customElement("resize-handle")
export class ResizeHandle extends BaseElement {
  @property({ type: String, reflect: true })
  position = "";

  @property({ type: String, reflect: true })
  axis: "vertical" | "horizontal" = "vertical";

  /** After short-press on touch: larger hit target. Ignored for fine-pointer hover. */
  @property({ type: Boolean, reflect: true })
  active = false;

  static get styles() {
    return [...BaseElement.styles, unsafeCSS(componentStyle)];
  }

  render() {
    return html`<div aria-hidden="true"></div>`;
  }
}
