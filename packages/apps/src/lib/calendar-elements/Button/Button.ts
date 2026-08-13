import { html, nothing, unsafeCSS } from "lit";
import { customElement, property } from "lit/decorators.js";
import { BaseElement } from "../BaseElement/BaseElement.js";
import {
  eventMatchesHotkey,
  getHotkeyDisplay,
  isEditableEventTarget,
  normalizeHotkey,
  toAriaHotkey,
} from "../shared/hotkey.js";
import componentStyle from "./Button.css?inline";

type ButtonType = "button" | "submit" | "reset";

@customElement("lc-button")
export class Button extends BaseElement {
  @property({ type: Boolean, reflect: true })
  disabled = false;

  @property({ type: Boolean, reflect: true })
  compact = false;

  @property({ type: String })
  label = "";

  @property({ type: String })
  hotkey = "";

  @property({ type: Boolean, reflect: true })
  raised = false;

  /**
   * Disclosure / popup pattern: forwarded to the inner `<button>`’s `aria-expanded`.
   * Use properties instead of setting `aria-expanded` on `<lc-button>` (host is not a button role).
   */
  @property({ attribute: false })
  disclosureExpanded: boolean | undefined = undefined;

  /** Forwarded to inner `aria-haspopup` when non-empty. */
  @property({ attribute: false })
  hasPopup: string | undefined = undefined;

  /** `id` of the controlled surface; forwarded to inner `aria-controls`. */
  @property({ attribute: false })
  controlsId: string | undefined = undefined;

  /** Raw attribute/property value; `get type()` exposes the safe subset for `<button type>`. */
  #typeAttribute = "button";

  @property({ type: String })
  get type(): ButtonType {
    const t = this.#typeAttribute;
    return t === "submit" || t === "reset" || t === "button" ? t : "button";
  }

  set type(value: string | null | undefined) {
    const next = value ?? "button";
    if (next === this.#typeAttribute) return;
    const previous = this.#typeAttribute;
    this.#typeAttribute = next;
    this.requestUpdate("type", previous);
  }

  static get styles() {
    return [...BaseElement.styles, unsafeCSS(componentStyle)];
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("keydown", this.#handleGlobalKeydown);
  }

  disconnectedCallback() {
    window.removeEventListener("keydown", this.#handleGlobalKeydown);
    super.disconnectedCallback();
  }

  render() {
    const hotkey = normalizeHotkey(this.hotkey);
    const hotkeyDisplay = getHotkeyDisplay(hotkey);
    const ariaHotkey = toAriaHotkey(hotkey);
    const hasVisibleTextContent = Boolean(this.textContent?.trim());
    const showHotkeyBadge = Boolean(hotkeyDisplay && hasVisibleTextContent);
    const ariaExpanded =
      this.disclosureExpanded === undefined ? nothing : this.disclosureExpanded ? "true" : "false";
    const ariaHasPopup = this.hasPopup?.trim() ? this.hasPopup : nothing;
    const ariaControls = this.controlsId?.trim() ? this.controlsId : nothing;
    return html`
      <button
        type=${this.type}
        class="lc-button"
        ?disabled=${this.disabled}
        aria-expanded=${ariaExpanded}
        aria-haspopup=${ariaHasPopup}
        aria-controls=${ariaControls}
        .ariaLabel=${this.label || null}
        .ariaKeyShortcuts=${ariaHotkey || null}
        .title=${hotkeyDisplay && this.label ? `${this.label} (${hotkeyDisplay})` : ""}
      >
        <span>
          <slot></slot>
          ${showHotkeyBadge ? html`<span data-hotkey-badge>${hotkeyDisplay}</span>` : nothing}
        </span>
      </button>
    `;
  }

  #handleGlobalKeydown = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    if (this.disabled || isEditableEventTarget(event.target)) return;
    if (!eventMatchesHotkey(event, this.hotkey)) return;

    const button = this.renderRoot.querySelector("button");
    if (!button) return;
    button.click();
    event.preventDefault();
  };
}
