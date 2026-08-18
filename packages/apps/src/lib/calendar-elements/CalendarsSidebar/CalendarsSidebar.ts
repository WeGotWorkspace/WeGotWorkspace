import type { CalendarsMap } from "@/lib/calendar-engine";
import { html, unsafeCSS } from "lit";
import { customElement } from "lit/decorators.js";
import { ifDefined } from "lit/directives/if-defined.js";
import { BaseElement } from "../BaseElement/BaseElement.js";
import componentStyle from "./CalendarsSidebar.css?inline";
import {
  calendarEntriesByAccount,
  calendarIdsInSidebarOrder,
} from "./calendarIdsInSidebarOrder.js";

@customElement("calendars-sidebar")
export class CalendarsSidebar extends BaseElement {
  declare calendars?: CalendarsMap;

  /**
   * Calendar ids whose events are shown. When unset, every calendar in `calendars` is visible.
   * Toggled via the color swatch checkboxes. Pass from the parent with `.visibleCalendarIds=${...}`.
   */
  declare visibleCalendarIds?: string[];

  /** Calendar that receives new events. Pass from the parent with `.selectedCalendarId=${...}`. */
  declare selectedCalendarId?: string;

  static get properties() {
    return {
      calendars: { type: Object },
      visibleCalendarIds: {
        type: Array,
        attribute: false,
        dispatchChangeEvent: { bubbles: true, composed: true },
      },
      selectedCalendarId: {
        type: String,
        attribute: false,
        dispatchChangeEvent: { bubbles: true, composed: true },
      },
    };
  }

  static get styles() {
    return [...BaseElement.styles, unsafeCSS(componentStyle)];
  }

  #effectiveVisibleSet(map: CalendarsMap): Set<string> {
    const explicit = this.visibleCalendarIds;
    if (explicit !== undefined) {
      return new Set(explicit);
    }
    return new Set(map.keys());
  }

  #onVisibilityChange(id: string, event: Event): void {
    event.stopPropagation();
    const input = event.target as HTMLInputElement;
    this.#setCalendarVisible(id, input.checked);
  }

  #setCalendarVisible(id: string, shouldShow: boolean): void {
    const map = this.calendars ?? new Map();
    const current = this.#effectiveVisibleSet(map);
    const nextSet = new Set(current);
    if (shouldShow) {
      nextSet.add(id);
    } else {
      nextSet.delete(id);
    }
    const order = calendarIdsInSidebarOrder(map);
    const nextIds = order.filter((calendarId) => nextSet.has(calendarId));
    this.visibleCalendarIds = nextIds;
  }

  #selectDefault(id: string): void {
    const map = this.calendars ?? new Map();
    if (!map.has(id)) return;

    const visible = this.#effectiveVisibleSet(map);
    if (!visible.has(id)) {
      const nextSet = new Set(visible);
      nextSet.add(id);
      const order = calendarIdsInSidebarOrder(map);
      const nextIds = order.filter((calendarId) => nextSet.has(calendarId));
      this.visibleCalendarIds = nextIds;
    }

    if (this.selectedCalendarId === id) return;
    this.selectedCalendarId = id;
  }

  render() {
    const map = this.calendars ?? new Map();
    const groups = calendarEntriesByAccount(map);
    const visible = this.#effectiveVisibleSet(map);
    const selectedId = this.selectedCalendarId;

    return html`
      <aside
        class="calendars-sidebar"
        aria-label="Calendars"
        dir=${ifDefined(this.dir === "rtl" || this.dir === "ltr" ? this.dir : undefined)}
      >
        <div class="calendar-list" role="radiogroup" aria-label="Selected calendar for new events">
          ${groups.map(
            (group, groupIndex) => html`
              <section
                class="calendar-account-group"
                aria-labelledby=${`calendars-sidebar-account-${groupIndex}`}
              >
                <h3 class="calendar-account-label" id=${`calendars-sidebar-account-${groupIndex}`}>
                  ${group.accountId}
                </h3>
                <div class="calendar-account-calendars" role="presentation">
                  ${group.entries.map(
                    ([id, cal]) => html`
                      <div
                        class="calendar-row ${visible.has(id)
                          ? ""
                          : "calendar-row--hidden"} ${selectedId === id
                          ? "calendar-row--selected"
                          : ""}"
                      >
                        <button
                          type="button"
                          class="calendar-default"
                          role="radio"
                          aria-checked=${selectedId === id ? "true" : "false"}
                          aria-label=${cal.displayName}
                          @click=${() => this.#selectDefault(id)}
                        >
                          <span class="calendar-name">${cal.displayName}</span>
                        </button>
                        <label
                          class="calendar-visibility"
                          title=${cal.url}
                          @click=${(e: Event) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            class="calendar-visibility-input"
                            .checked=${visible.has(id)}
                            aria-label=${`Show events for ${cal.displayName}`}
                            @change=${(e: Event) => this.#onVisibilityChange(id, e)}
                            @click=${(e: Event) => e.stopPropagation()}
                          />
                          <span
                            class="calendar-swatch"
                            style=${`--calendar-swatch-color: ${cal.color}`}
                            aria-hidden="true"
                          ></span>
                        </label>
                      </div>
                    `,
                  )}
                </div>
              </section>
            `,
          )}
        </div>
      </aside>
    `;
  }
}
