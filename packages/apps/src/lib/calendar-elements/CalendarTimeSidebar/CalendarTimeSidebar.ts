import { html, unsafeCSS } from "lit";
import { customElement } from "lit/decorators.js";
import { BaseElement } from "../BaseElement/BaseElement.js";
import { getLocaleDirection } from "../utils/Locale.js";
import { getHourlyTimeLabels } from "../utils/TimeFormatting.js";
import componentStyle from "./CalendarTimeSidebar.css?inline";

@customElement("calendar-time-sidebar")
export class CalendarTimeSidebar extends BaseElement {
  lang = "";
  /** Raw property value; `get hours()` clamps to 1–24. */
  #hoursRaw = 24;
  /** Raw property value; `get startHour()` clamps to 0–23. */
  #startHourRaw = 0;

  static get properties() {
    return {
      lang: { type: String },
      hours: { type: Number },
      startHour: { type: Number, attribute: "start-hour" },
    } as const;
  }

  static get styles() {
    return [...BaseElement.styles, unsafeCSS(componentStyle)];
  }

  get hours(): number {
    const parsed = Number(this.#hoursRaw);
    return !Number.isFinite(parsed) ? 24 : Math.max(1, Math.min(24, Math.floor(parsed)));
  }

  set hours(value: number | string | null | undefined) {
    const n = Number(value);
    const next = Number.isFinite(n) ? n : NaN;
    if (Object.is(next, this.#hoursRaw)) return;
    const previous = this.#hoursRaw;
    this.#hoursRaw = next;
    this.requestUpdate("hours", previous);
  }

  /** First labelled hour (default 0); with `hours < 24` this shows a sub-range like 08:00–20:00. */
  get startHour(): number {
    const parsed = Number(this.#startHourRaw);
    return !Number.isFinite(parsed) ? 0 : Math.max(0, Math.min(23, Math.floor(parsed)));
  }

  set startHour(value: number | string | null | undefined) {
    const n = Number(value);
    const next = Number.isFinite(n) ? n : NaN;
    if (Object.is(next, this.#startHourRaw)) return;
    const previous = this.#startHourRaw;
    this.#startHourRaw = next;
    this.requestUpdate("startHour", previous);
  }

  render() {
    const direction = getLocaleDirection(this.lang);
    const hours = this.hours;
    const startHour = this.startHour;
    const hourlyLabels = getHourlyTimeLabels(this.lang, hours, startHour);
    const endLabel = getHourlyTimeLabels(this.lang, 1, startHour + hours)[0] ?? "00:00";
    const labels = [...hourlyLabels, endLabel];
    const hourSlots = Math.max(1, hours);

    return html`
      <div class="time-sidebar" dir=${direction}>
        <div class="weekday-header-slot" aria-hidden="true"></div>
        <div class="all-day-slot" aria-hidden="true"></div>
        <div class="timed-slot">
          <div class="hour-labels" style=${`--_lc-time-sidebar-hours: ${hourSlots};`}>
            ${labels.map(
              (label) => html`
                <div class="hour-label-row">
                  <span class="hour-label">${label}</span>
                </div>
              `,
            )}
          </div>
        </div>
      </div>
    `;
  }
}
