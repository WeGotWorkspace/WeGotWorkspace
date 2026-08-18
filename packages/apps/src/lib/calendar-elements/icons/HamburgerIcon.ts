import { html } from "lit";

type HamburgerIconOptions = {
  className?: string;
};

export function renderHamburgerIcon(options: HamburgerIconOptions = {}) {
  const { className = "" } = options;
  return html`
    <svg
      class=${className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <path d="M4 6h16M4 12h16M4 18h16"></path>
    </svg>
  `;
}
