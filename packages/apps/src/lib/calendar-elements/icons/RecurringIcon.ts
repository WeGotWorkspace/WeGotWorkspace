import { html } from "lit";

type RecurringIconOptions = {
  className?: string;
};

export function renderRecurringIcon(options: RecurringIconOptions = {}) {
  const { className = "" } = options;
  return html`
    <svg
      class=${className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      aria-hidden="true"
    >
      <path
        d="M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3"
        stroke-linecap="round"
        stroke-linejoin="round"
      ></path>
    </svg>
  `;
}
