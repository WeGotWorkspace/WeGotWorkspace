import { html, unsafeCSS } from "lit";
import { customElement, property } from "lit/decorators.js";
import { BaseElement } from "../BaseElement/BaseElement";
import componentStyle from "./ResizeHandle.css?inline";

/** True when this event is the selected one and should show coarse-pointer grabbers. */
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

  /** After select on touch: larger grabbers. Ignored for fine-pointer hover bars. */
  @property({ type: Boolean, reflect: true })
  active = false;

  static get styles() {
    return [...BaseElement.styles, unsafeCSS(componentStyle)];
  }

  render() {
    return html`<div aria-hidden="true"></div>`;
  }
}
