import { html } from "lit";

type CalendarIconOptions = {
  className?: string;
};

export function renderCalendarIcon(options: CalendarIconOptions = {}) {
  const { className = "" } = options;
  return html`
    <svg
      class=${className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      aria-hidden="true"
    >
      <rect x="3" y="4.5" width="18" height="15" rx="2.5"></rect>
      <path d="M3 9.5h18"></path>
      <path d="M8.25 2.75v3.5M15.75 2.75v3.5" stroke-linecap="round"></path>
    </svg>
  `;
}
