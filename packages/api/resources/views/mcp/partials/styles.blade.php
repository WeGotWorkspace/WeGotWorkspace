<style>
    /*
     * Standalone MCP OAuth pages (not the PWA). Token values match Settings:
     * --color-ink, --color-cream, --control-radius. Allow / switch-on / focus
     * use the login shell navy (--workspace-home-bg), not the cream page tint.
     */
    :root {
        --color-ink: #042a22;
        --color-cream: #ffffff;
        --workspace-home-bg: #1b1d3a;
        --settings-accent: var(--workspace-home-bg);
        --control-radius: 0.1875rem;
        --mcp-page-bg: color-mix(in oklab, #64748b 6%, var(--color-cream));
        --mcp-card-bg: var(--color-cream);
        --mcp-border: color-mix(in oklab, var(--color-ink) 12%, transparent);
        --mcp-muted: color-mix(in oklab, var(--color-ink) 72%, transparent);
        --mcp-faint: color-mix(in oklab, var(--color-ink) 78%, transparent);
        --mcp-warn-bg: color-mix(in oklab, #c98a1f 14%, transparent);
        --mcp-warn-border: color-mix(in oklab, #c98a1f 35%, transparent);
        --mcp-error-bg: color-mix(in oklab, #b14242 14%, transparent);
        --mcp-error-fg: #991b1b;
        --mcp-focus: var(--settings-accent);
        --mcp-control-height: 2.25rem;
    }

    * { box-sizing: border-box; }

    body.mcp-page {
        font-family: system-ui, sans-serif;
        background: var(--mcp-page-bg);
        color: var(--color-ink);
        margin: 0;
        min-height: 100dvh;
        line-height: 1.5;
    }

    .mcp-shell {
        max-width: 28rem;
        margin: 3rem auto;
        padding: 0 1.5rem 2rem;
    }

    .mcp-shell--wide {
        max-width: 36rem;
    }

    .mcp-card {
        position: relative;
        max-width: 28rem;
        margin: 3rem auto;
        background: var(--mcp-card-bg);
        border: 1px solid var(--mcp-border);
        border-radius: 0.75rem;
        padding: 1.75rem;
    }

    .mcp-card--wide {
        max-width: 36rem;
    }

    .mcp-shell .mcp-card {
        margin: 0;
        max-width: none;
    }

    .mcp-header {
        position: relative;
    }

    @font-face {
        font-family: "Libre Caslon Condensed";
        src: url("/fonts/LibreCaslonCondensed.woff2") format("woff2-variations");
        font-weight: 100 900;
        font-style: normal;
        font-display: swap;
    }

    .mcp-eyebrow {
        margin: 0 0 0.5rem;
        font-family: ui-monospace, monospace;
        font-size: 0.75rem;
        font-weight: 400;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--mcp-muted);
    }

    h1 {
        font-size: 1.35rem;
        font-weight: 650;
        line-height: 1.3;
        margin: 0 0 0.75rem;
    }

    .mcp-title {
        font-family: "Libre Caslon Condensed", Georgia, serif;
        font-size: 2.25rem;
        font-weight: 400;
        line-height: 1.15;
        letter-spacing: -0.025em;
        margin: 0 0 0.5rem;
        padding-right: 3.5rem;
        color: var(--color-ink);
    }

    .mcp-lead {
        margin: 0 0 1.25rem;
        font-size: 1rem;
        font-weight: 400;
        line-height: 1.5;
        color: color-mix(in oklab, var(--color-ink) 78%, transparent);
    }

    p {
        margin: 0 0 0.85rem;
        color: color-mix(in oklab, var(--color-ink) 78%, transparent);
    }

    .mcp-origin {
        font-weight: 700;
        word-break: break-word;
    }

    .mcp-avatar {
        position: absolute;
        top: 0;
        right: 0;
        width: 2.25rem;
        height: 2.25rem;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        border-radius: 9999px;
        font-size: 11px;
        font-weight: 500;
        background: color-mix(in oklab, var(--color-ink) 12%, transparent);
        color: var(--color-ink);
    }

    .mcp-warn {
        background: var(--mcp-warn-bg);
        border: 1px solid var(--mcp-warn-border);
        padding: 0.75rem 0.85rem;
        border-radius: var(--control-radius);
        color: var(--color-ink);
        margin: 0.75rem 0 0;
        font-size: 0.9rem;
        overflow: visible;
        overflow-wrap: anywhere;
        white-space: normal;
    }

    .mcp-warn__title {
        display: block;
        font-weight: 650;
        margin: 0 0 0.15rem;
        color: var(--color-ink);
    }

    .mcp-error {
        background: var(--mcp-error-bg);
        color: var(--mcp-error-fg);
        padding: 0.6rem 0.75rem;
        border-radius: var(--control-radius);
    }

    .mcp-permissions-intro {
        margin: 0 0 0.5rem;
        font-family: "Libre Caslon Condensed", Georgia, serif;
        font-size: 1.5rem;
        font-weight: 400;
        line-height: 1;
        letter-spacing: -0.025em;
        color: var(--color-ink);
    }

    .mcp-permissions-hint {
        margin: 0;
        font-size: 0.9rem;
        color: var(--mcp-muted);
    }

    .mcp-scope-groups {
        display: flex;
        flex-direction: column;
        margin-top: 2rem;
    }

    .mcp-scope-group {
        border: 0;
        margin: 0;
        padding: 0;
        min-width: 0;
        min-inline-size: 0;
        background: transparent;
    }

    .mcp-scope-group + .mcp-scope-group {
        margin-top: 1.25rem;
        padding-top: 1.25rem;
        border-top: 1px solid var(--mcp-border);
    }

    .mcp-scope-group__heading {
        display: flex;
        align-items: center;
        gap: 0.625rem;
        margin: 0 0 0.25rem;
        padding: 0;
        font-family: inherit;
        font-weight: 650;
        font-size: 1rem;
        line-height: 1.25;
        color: var(--color-ink);
    }

    .mcp-app-icon {
        width: 1.75rem;
        height: 1.75rem;
        border-radius: 6px;
        object-fit: cover;
        flex-shrink: 0;
    }

    .mcp-scope {
        display: flex;
        gap: 1rem;
        align-items: center;
        justify-content: space-between;
        margin: 0;
        padding: 0.5rem 0;
        min-height: 2.5rem;
        color: var(--color-ink);
    }

    .mcp-scope__desc {
        flex: 1;
        min-width: 0;
        font-size: 0.875rem;
        color: var(--color-ink);
        cursor: default;
    }

    .mcp-switch {
        position: relative;
        flex-shrink: 0;
        width: 2.75rem;
        height: 1.5rem;
    }

    .mcp-switch input {
        position: absolute;
        inset: 0;
        z-index: 1;
        margin: 0;
        width: 100%;
        height: 100%;
        opacity: 0;
        cursor: pointer;
    }

    .mcp-switch__track {
        display: block;
        width: 100%;
        height: 100%;
        border-radius: 999px;
        background: color-mix(in oklab, var(--color-ink) 18%, var(--color-cream));
        pointer-events: none;
        transition: background-color 150ms ease;
    }

    .mcp-switch__track::after {
        content: "";
        position: absolute;
        top: 0.125rem;
        left: 0.125rem;
        width: 1.25rem;
        height: 1.25rem;
        border-radius: 999px;
        background: var(--color-cream);
        box-shadow: 0 1px 2px color-mix(in oklab, var(--color-ink) 22%, transparent);
        transition: transform 150ms ease;
    }

    .mcp-switch input:checked + .mcp-switch__track {
        background: var(--settings-accent);
    }

    .mcp-switch input:checked + .mcp-switch__track::after {
        transform: translateX(1.25rem);
    }

    .mcp-switch input:focus-visible + .mcp-switch__track {
        outline: 2px solid var(--mcp-focus);
        outline-offset: 2px;
    }

    .mcp-actions {
        display: flex;
        gap: 0.75rem;
        margin-top: 1.35rem;
    }

    .mcp-btn {
        flex: 1;
        min-height: var(--mcp-control-height);
        padding: 0.55rem 0.85rem;
        border-radius: var(--control-radius);
        font-weight: 600;
        font-size: 0.9rem;
        cursor: pointer;
        text-align: center;
        text-decoration: none;
        font-family: inherit;
    }

    .mcp-btn:focus-visible {
        outline: 2px solid var(--mcp-focus);
        outline-offset: 2px;
    }

    .mcp-btn--primary {
        border: 0;
        background: var(--settings-accent);
        color: #ffffff;
    }

    .mcp-btn--primary:hover {
        opacity: 0.92;
    }

    .mcp-btn--secondary {
        background: var(--mcp-card-bg);
        border: 1px solid color-mix(in oklab, var(--color-ink) 20%, transparent);
        color: var(--color-ink);
    }

    .mcp-btn--secondary:hover {
        background: color-mix(in oklab, var(--color-ink) 6%, transparent);
    }

    .mcp-field {
        display: block;
        font-weight: 600;
        margin: 0.75rem 0 0.25rem;
        color: var(--color-ink);
    }

    .mcp-input {
        width: 100%;
        min-height: var(--mcp-control-height);
        padding: 0.5rem 0.7rem;
        border: 1px solid var(--mcp-border);
        border-radius: var(--control-radius);
        background: var(--mcp-card-bg);
        color: var(--color-ink);
        font: inherit;
    }

    .mcp-input:focus-visible {
        outline: 2px solid var(--mcp-focus);
        outline-offset: 1px;
        border-color: var(--mcp-focus);
    }

    .mcp-login-submit {
        margin-top: 1rem;
        width: 100%;
    }

    @media (prefers-reduced-motion: reduce) {
        .mcp-btn, .mcp-scope, .mcp-switch__track, .mcp-switch__track::after { transition: none; }
    }
</style>
