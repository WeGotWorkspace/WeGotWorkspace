import { html } from "lit";

type PlusIconOptions = {
  className?: string;
};

export function renderPlusIcon(options: PlusIconOptions = {}) {
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
      <path d="M12 5v14M5 12h14" stroke-linecap="round"></path>
    </svg>
  `;
}
