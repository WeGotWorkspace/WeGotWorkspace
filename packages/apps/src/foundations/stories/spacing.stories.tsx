import type { Meta, StoryObj } from "@storybook/react-vite";

/**
 * Docs-only pointer at CSS spacing / control-size tokens. Live knobs stay under Branding.
 * Source: `packages/apps/src/styles.css` (`--control-height-*`, `--radius-*`, panel motion).
 */
function SpacingOverview() {
  return (
    <article style={{ maxWidth: "40rem", fontFamily: "var(--font-sans)", lineHeight: 1.5 }}>
      <h1 style={{ fontFamily: "var(--font-mark)", fontSize: "1.75rem", marginBottom: "0.5rem" }}>
        Spacing
      </h1>
      <p
        style={{
          marginBottom: "1rem",
          color: "color-mix(in oklab, var(--color-ink) 70%, transparent)",
        }}
      >
        Control sizing and radius are tokenized in <code>packages/apps/src/styles.css</code>:{" "}
        <code>--control-height-xs</code> … <code>--control-height-xl</code>,{" "}
        <code>--input-height</code>, <code>--control-radius</code>, and <code>--radius-*</code>.
        Panel overlay motion uses <code>--panel-overlay-duration</code> /{" "}
        <code>--panel-overlay-ease</code>.
      </p>
      <p style={{ marginBottom: "1rem" }}>
        Layout rhythm on real app shells is easiest to judge under <strong>Branding</strong>{" "}
        (sidebar, headers, lockup). This page only points at the tokens.
      </p>
      <div style={{ display: "flex", alignItems: "flex-end", gap: "0.75rem", flexWrap: "wrap" }}>
        {(
          [
            ["xs", "var(--control-height-xs)"],
            ["sm", "var(--control-height-sm)"],
            ["md", "var(--control-height-md)"],
            ["lg", "var(--control-height-lg)"],
            ["xl", "var(--control-height-xl)"],
          ] as const
        ).map(([label, height]) => (
          <div key={label} style={{ textAlign: "center", fontSize: "0.75rem" }}>
            <div
              style={{
                width: "2.5rem",
                height,
                background: "color-mix(in oklab, var(--color-ink) 18%, transparent)",
                borderRadius: "var(--control-radius, 0.375rem)",
                marginBottom: "0.25rem",
              }}
            />
            {label}
          </div>
        ))}
      </div>
    </article>
  );
}

const meta = {
  title: "Foundations/Spacing",
  component: SpacingOverview,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Short pointer at control height, radius, and related spacing tokens. Live chrome stays under Branding.",
      },
    },
  },
} satisfies Meta<typeof SpacingOverview>;

export default meta;
type Story = StoryObj<typeof SpacingOverview>;

export const Overview: Story = {};
