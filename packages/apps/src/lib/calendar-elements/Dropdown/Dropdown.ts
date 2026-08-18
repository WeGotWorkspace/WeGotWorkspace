import { html, nothing, unsafeCSS } from "lit";
import { customElement, property } from "lit/decorators.js";
import { BaseElement } from "../BaseElement/BaseElement.js";
import {
  getPlainCharacterHotkey,
  isEditableEventTarget,
  normalizeHotkey,
} from "../shared/hotkey.js";
import type { DropdownOption } from "../types/Dropdown.js";
import componentStyle from "./Dropdown.css?inline";

@customElement("lc-dropdown")
export class Dropdown extends BaseElement {
  #value = "";
  #fallbackSelectId = `lc-dropdown-${Math.random().toString(36).slice(2)}`;
  #pointerFocus = false;

  @property({ type: Array })
  options: Array<DropdownOption | string> = [];

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

  @property({ type: String, attribute: "aria-label" })
  ariaLabel = "Select option";

  @property({ type: String })
  placeholder = "Select an option";

  @property({ type: String })
  hotkey = "";

  @property({ type: Boolean, reflect: true })
  disabled = false;

  @property({ type: Boolean, attribute: "icon-only", reflect: true })
  iconOnly = false;

  static get properties() {
    return {
      value: { type: String, dispatchChangeEvent: { bubbles: true, composed: true } },
    } as const;
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

  override firstUpdated(changedProperties: Map<PropertyKey, unknown>): void {
    super.firstUpdated(changedProperties);
    this.#syncSelectValue();
  }

  override updated(changedProperties: Map<PropertyKey, unknown>): void {
    super.updated(changedProperties);
    if (changedProperties.has("value") || changedProperties.has("options")) {
      this.#syncSelectValue();
    }
  }

  render() {
    const normalizedOptions = this.options.map((option) => this.#normalizeOption(option));
    const hasSelection = normalizedOptions.some((option) => option.value === this.value);
    const ownHotkey = normalizeHotkey(this.hotkey);
    const hasCustomIcon = this.#hasAssignedIcon();

    const selectState = hasSelection ? "selected" : "placeholder";

    return html`
      <div>
        <select
          .id=${this.#fallbackSelectId}
          .name=${this.name}
          class="lc-dropdown-select"
          data-state=${selectState}
          .ariaLabel=${this.ariaLabel}
          .ariaKeyShortcuts=${ownHotkey || null}
          ?disabled=${this.disabled}
          .value=${this.value}
          @pointerdown=${this.#handlePointerDown}
          @keydown=${this.#handleSelectKeydown}
          @focus=${this.#handleSelectFocus}
          @blur=${this.#handleSelectBlur}
          @change=${this.#handleChange}
        >
          ${!hasSelection
            ? html`<option value="" disabled selected>${this.placeholder}</option>`
            : nothing}
          ${normalizedOptions.map(
            (option) => html`
              <option value=${option.value} ?disabled=${option.disabled}>${option.label}</option>
            `,
          )}
        </select>
        ${hasCustomIcon
          ? html`
              <span data-role="icon" aria-hidden="true">
                <slot name="icon" @slotchange=${() => this.requestUpdate()}></slot>
              </span>
            `
          : html`
              <span data-role="chevron" aria-hidden="true">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                  style="width: 1rem; height: 1rem;"
                >
                  <path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round"></path>
                </svg>
              </span>
            `}
      </div>
    `;
  }

  #handleChange = (event: Event) => {
    const target = event.target as HTMLSelectElement | null;
    if (!target) return;
    this.value = target.value;
  };

  #handlePointerDown = () => {
    this.#pointerFocus = true;
  };

  #handleSelectKeydown = (event: KeyboardEvent) => {
    const key = event.key;
    if (key === "Tab" || key.startsWith("Arrow") || key === "Enter" || key === " ") {
      this.#pointerFocus = false;
      const target = event.currentTarget as HTMLSelectElement | null;
      if (target) {
        target.removeAttribute("data-pointer-focus");
      }
    }
  };

  #handleSelectFocus = (event: FocusEvent) => {
    const target = event.currentTarget as HTMLSelectElement | null;
    if (!target) return;
    if (this.#pointerFocus) {
      target.setAttribute("data-pointer-focus", "true");
      return;
    }
    target.removeAttribute("data-pointer-focus");
  };

  #handleSelectBlur = (event: FocusEvent) => {
    const target = event.currentTarget as HTMLSelectElement | null;
    if (!target) return;
    target.removeAttribute("data-pointer-focus");
  };

  #handleGlobalKeydown = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    if (this.disabled || isEditableEventTarget(event.target)) return;
    const pressedHotkey = getPlainCharacterHotkey(event);
    if (!pressedHotkey) return;

    const normalizedOptions = this.options.map((option) => this.#normalizeOption(option));
    const matchedOption = normalizedOptions.find(
      (option) => !option.disabled && normalizeHotkey(option.hotkey) === pressedHotkey,
    );
    if (matchedOption) {
      if (matchedOption.value !== this.value) {
        this.value = matchedOption.value;
      }
      this.#focusSelect();
      event.preventDefault();
      return;
    }

    const ownHotkey = normalizeHotkey(this.hotkey);
    if (!ownHotkey || pressedHotkey !== ownHotkey) return;
    this.#focusSelect();
    event.preventDefault();
  };

  #focusSelect() {
    const select = this.renderRoot.querySelector<HTMLSelectElement>("select");
    if (!select) return;
    select.focus();
  }

  #syncSelectValue() {
    const select = this.renderRoot.querySelector<HTMLSelectElement>("select");
    if (!select) return;

    const normalizedOptions = this.options.map((option) => this.#normalizeOption(option));
    const hasSelection = normalizedOptions.some((option) => option.value === this.value);
    const nextValue = hasSelection ? this.value : "";
    if (select.value !== nextValue) {
      select.value = nextValue;
    }
  }

  #normalizeOption(option: DropdownOption | string): DropdownOption {
    if (typeof option === "string") {
      return { label: option, value: option };
    }

    return option;
  }

  #hasAssignedIcon(): boolean {
    const iconElement = this.querySelector("[slot='icon']");
    if (!iconElement) return false;
    return true;
  }
}
