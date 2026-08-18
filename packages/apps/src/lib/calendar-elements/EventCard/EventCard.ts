import { ContextConsumer } from "@lit/context";
import { html, nothing, unsafeCSS } from "lit";
import { customElement, property } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { BaseElement } from "../BaseElement/BaseElement";
import { type CalendarViewContextValue, calendarViewContext } from "../context/CalendarViewContext";
import { renderRecurringIcon } from "../icons/RecurringIcon";
import { getEventColorStyles, surfaceTint } from "../utils/EventColor";
import { getLocaleDirection } from "../utils/Locale";
import componentStyle from "./EventCard.css?inline";

const EVENT_COLOR_HOST_KEYS = [
  "--_lc-event-bg",
  "--_lc-event-border-color",
  "--_lc-event-bg-hover",
  "--_lc-event-bg-active",
  "--_lc-event-bg-focus",
  "--_lc-event-text-color",
  "--_lc-event-focus-ring-light",
  "--_lc-event-accent-color",
  "--_lc-event-shadow",
] as const;

@customElement("event-card")
export class EventCard extends BaseElement {
  @property({ type: String })
  lang = "";

  #calendarView?: CalendarViewContextValue;
  #calendarViewConsumer = new ContextConsumer(this, {
    context: calendarViewContext,
    subscribe: true,
    callback: (value: CalendarViewContextValue | undefined) => {
      this.#calendarView = value;
      this.requestUpdate();
    },
  });

  @property({ type: String })
  summary = "";

  @property({ type: String })
  time = "";

  @property({ type: String, attribute: "time-detail" })
  timeDetail = "";

  @property({ type: String })
  location = "";

  /** Hex (`#rrggbb`) or other CSS color; hex applies the shared tinted palette on this host. */
  @property({ type: String })
  color = "";

  @property({ type: String, reflect: true })
  layout: "absolute" | "flow" = "absolute";

  @property({ type: Boolean, reflect: true })
  past = false;

  @property({ type: Boolean, reflect: true })
  recurring = false;

  @property({ type: Boolean, reflect: true })
  exception = false;

  static get styles() {
    return [...BaseElement.styles, unsafeCSS(componentStyle)];
  }

  connectedCallback() {
    super.connectedCallback();
    void this.#calendarViewConsumer;
    this.#syncColorFromProp();
  }

  override updated(changedProperties: Map<string | number | symbol, unknown>) {
    super.updated(changedProperties);
    if (changedProperties.has("color")) {
      this.#syncColorFromProp();
    }
  }

  /** Whether the host color custom properties were set by this component (vs. by a consumer). */
  #appliedColorHostKeys = false;

  #syncColorFromProp() {
    // Only clear keys this component set itself: consumers without a `color`
    // prop (e.g. the list view) apply the same custom properties externally
    // via inline styles, and those must survive connect/first-update.
    if (this.#appliedColorHostKeys) {
      for (const key of EVENT_COLOR_HOST_KEYS) {
        this.style.removeProperty(key);
      }
      this.#appliedColorHostKeys = false;
    }
    const trimmed = this.color?.trim() ?? "";
    if (!trimmed) return;
    const fromHex = getEventColorStyles(trimmed);
    if (Object.keys(fromHex).length > 0) {
      for (const [key, value] of Object.entries(fromHex)) {
        this.style.setProperty(key, value);
      }
      this.#appliedColorHostKeys = true;
      return;
    }
    this.style.setProperty("--_lc-event-bg", surfaceTint(trimmed, 11));
    this.style.setProperty("--_lc-event-accent-color", trimmed);
    this.#appliedColorHostKeys = true;
  }

  get dir() {
    return getLocaleDirection(this.lang || this.#calendarView?.lang);
  }

  render() {
    const time = this.time?.trim() ?? "";
    const timeDetail = this.timeDetail?.trim() ?? "";
    const hasTimeLabel = Boolean(time || timeDetail);
    const location = this.location?.trim() ?? "";
    const hasLocation = Boolean(location);
    const hasMeta = hasTimeLabel || hasLocation;
    const compactTime = time.split(" - ")[0]?.trim() ?? "";
    const compactTimeLabel = [compactTime, timeDetail ? `(${timeDetail})` : ""]
      .filter(Boolean)
      .join(" ");

    return html`
      <div
        class=${classMap({
          "event-card-shell": true,
          "event-card-overlap": this.#isOverlappingIndentedCard,
        })}
        dir=${this.dir}
      >
        ${this.#srPast()} ${this.#srRecurrence()}
        <!-- WGW a11y: was <h6> — inside the workspace document that skips heading
             levels (axe heading-order). Card titles are not structural headings. -->
        <div class="event-card-heading">
          <span class="event-card-content">
            <span class="event-card-compact-label">
              ${hasTimeLabel
                ? html`<span class="event-card-compact-time">${compactTimeLabel}</span
                    ><span aria-hidden="true"> </span>`
                : ""}<span>${this.summary}</span>
            </span>
            <span class="event-card-summary-main">${this.summary}</span>
            ${hasMeta ? this.#renderMetaBlock(hasTimeLabel, hasLocation, location) : nothing}
          </span>
          ${this.recurring && !this.exception ? this.#renderRecurringIcon() : nothing}
        </div>
        <slot></slot>
      </div>
    `;
  }

  #srPast() {
    return this.past ? html`<span class="sr-only">Past event.</span>` : nothing;
  }

  #srRecurrence() {
    const label = this.#recurrenceStatusSrLabel;
    return label ? html`<span class="sr-only">${label}</span>` : nothing;
  }

  #renderMetaBlock(hasTimeLabel: boolean, hasLocation: boolean, location: string) {
    const timeRow = hasTimeLabel
      ? html`<span class="event-card-time-main">${this.time}</span>${this.timeDetail
            ? html`<span class="event-card-time-detail">(${this.timeDetail})</span>`
            : nothing}`
      : nothing;
    return html`
      <time class="event-card-time">${timeRow}</time>
      ${hasLocation ? html`<span class="event-card-location">${location}</span>` : nothing}
    `;
  }

  #renderRecurringIcon() {
    return html`
      <span class="event-card-recurring-icon-wrap" aria-hidden="true">
        ${renderRecurringIcon({ className: "event-card-recurring-icon" })}
      </span>
    `;
  }

  get #recurrenceStatusSrLabel(): string {
    if (this.exception) return "Exception to recurring series.";
    if (this.recurring) return "Recurring event.";
    return "";
  }

  get #isOverlappingIndentedCard(): boolean {
    const indentationRaw = this.style.getPropertyValue("--_lc-indentation").trim();
    if (indentationRaw.length === 0) return false;
    const indentation = Number.parseFloat(indentationRaw);
    return Number.isFinite(indentation) && indentation > 0;
  }
}
