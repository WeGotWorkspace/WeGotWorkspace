import { html, unsafeCSS } from "lit";
import { customElement, property } from "lit/decorators.js";
import { BaseElement } from "../BaseElement/BaseElement";
import componentStyle from "./ResizeHandle.css?inline";

@customElement("resize-handle")
export class ResizeHandle extends BaseElement {
  @property({ type: String, reflect: true })
  position = "";

  @property({ type: String, reflect: true })
  axis: "vertical" | "horizontal" = "vertical";

  static get styles() {
    return [...BaseElement.styles, unsafeCSS(componentStyle)];
  }

  render() {
    return html`<div aria-hidden="true"></div>`;
  }
}
