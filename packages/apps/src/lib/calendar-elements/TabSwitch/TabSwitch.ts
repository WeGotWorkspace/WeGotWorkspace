import { html, nothing, unsafeCSS } from "lit";
import { customElement, property } from "lit/decorators.js";
import { BaseElement } from "../BaseElement/BaseElement.js";
import {
  getPlainCharacterHotkey,
  isEditableEventTarget,
  normalizeHotkey,
} from "../shared/hotkey.js";
import type { TabSwitchOption } from "../types/TabSwitch.js";
import componentStyle from "./TabSwitch.css?inline";

let tabSwitchInstanceId = 0;

@customElement("tab-switch")
export class TabSwitch extends BaseElement {
  #groupName = `tab-switch-${++tabSwitchInstanceId}`;
  #value = "";

  @property({ type: Array })
  options: Array<TabSwitchOption | string> = [];

  get value(): string {
    return this.#value;
  }

  set value(value: string) {
    const nextValue = value ?? "";
    if (this.#value === nextValue) return;
    const oldValue = this.#value;
    this.#value = nextValue;
    this.requestUpdate("value", oldValue);
  }

  @property({ type: String })
  name = "";

  @property({ type: String, attribute: "group-label" })
  ariaLabel = "Options";

  @property({ type: Boolean, reflect: true })
  compact = false;

  @property({ type: Boolean, attribute: "show-hotkeys" })
  showHotkeys = true;

  static get properties() {
    return {
      value: { type: String, dispatchChangeEvent: { composed: true } },
    } as const;
  }

  static get styles() {
    return [...BaseElement.styles, unsafeCSS(componentStyle)];
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("keydown", this.#handleGlobalKeydown);
    const deprecatedAriaLabel = this.getAttribute("aria-label");
    if (deprecatedAriaLabel && !this.hasAttribute("group-label")) {
      this.ariaLabel = deprecatedAriaLabel;
    }

    // Keep host free of aria-label to avoid invalid ARIA on custom elements without host role.
    if (this.hasAttribute("aria-label")) {
      this.removeAttribute("aria-label");
    }
  }

  disconnectedCallback() {
    window.removeEventListener("keydown", this.#handleGlobalKeydown);
    super.disconnectedCallback();
  }

  render() {
    const groupName = this.name || this.#groupName;
    const normalizedOptions = this.options.map((option) => this.#normalizeOption(option));
    return html`
      <div role="radiogroup" aria-label=${this.ariaLabel}>
        ${normalizedOptions.map((option, index) => {
          const inputId = `${groupName}-${option.value}-${index}`;
          const isChecked = option.value === this.value;
          const hotkey = this.showHotkeys ? option.hotkey?.trim() : "";
          const inputAriaLabel = this.#inputAccessibleName(option);
          return html`
            <div>
              <input
                id=${inputId}
                type="radio"
                name=${groupName}
                value=${option.value}
                .checked=${isChecked}
                aria-label=${inputAriaLabel}
                aria-keyshortcuts=${hotkey || nothing}
                @change=${(e: Event) => this.#handleChange(e)}
              />
              <label for=${inputId} title=${this.#optionTitle(option)}>
                <span>${option.label}</span>
              </label>
            </div>
          `;
        })}
      </div>
    `;
  }

  #handleChange(e: Event) {
    const value = (e.target as HTMLInputElement).value as string;
    this.value = value;
  }

  #handleGlobalKeydown = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    if (isEditableEventTarget(event.target)) return;
    const hotkey = getPlainCharacterHotkey(event);
    if (!hotkey) return;
    const normalizedOptions = this.options.map((option) => this.#normalizeOption(option));
    const matchedIndex = normalizedOptions.findIndex(
      (option) => normalizeHotkey(option.hotkey) === hotkey,
    );
    if (matchedIndex < 0) return;
    const matchedOption = normalizedOptions[matchedIndex];
    if (matchedOption.value === this.value) return;

    // Trigger the same path as a user click so checked state and events stay in sync.
    const inputs = this.renderRoot.querySelectorAll<HTMLInputElement>("input[type='radio']");
    const matchedInput = inputs.item(matchedIndex);
    if (!matchedInput) return;
    matchedInput.click();
    event.preventDefault();
  };

  #normalizeOption(option: TabSwitchOption | string): TabSwitchOption {
    if (typeof option === "string") {
      return { label: option, value: option };
    }
    return option;
  }

  #optionTitle(option: TabSwitchOption): string {
    const labelText =
      option.ariaLabel ?? (typeof option.label === "string" ? option.label : option.value);
    const hotkey = option.hotkey?.trim();
    return hotkey ? `${labelText} (${hotkey.toUpperCase()})` : labelText;
  }

  /**
   * Icon or custom markup in `option.label` does not give the radio an accessible name.
   * Use explicit aria-label in those cases so each control passes label/name checks.
   */
  #inputAccessibleName(option: TabSwitchOption): string | typeof nothing {
    if (typeof option.label === "string" && option.label.trim() !== "") {
      return nothing;
    }
    const name = (option.ariaLabel ?? option.value).trim();
    return name || option.value;
  }
}
