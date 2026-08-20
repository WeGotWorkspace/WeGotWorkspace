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
