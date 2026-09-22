import type { Meta, StoryObj } from "@storybook/react-vite";

/**
 * Docs-only pointer at CSS type tokens. Live knobs stay under Branding.
 * Source: `packages/apps/src/styles.css` (`--font-*`, `--input-font-size-*`).
 */
function TypographyOverview() {
  return (
    <article style={{ maxWidth: "40rem", fontFamily: "var(--font-sans)", lineHeight: 1.5 }}>
      <h1 style={{ fontFamily: "var(--font-mark)", fontSize: "1.75rem", marginBottom: "0.5rem" }}>
        Typography
      </h1>
      <p
        style={{
          marginBottom: "1rem",
          color: "color-mix(in oklab, var(--color-ink) 70%, transparent)",
        }}
      >
        Font roles are CSS variables: <code>--font-sans</code> (system UI),{" "}
        <code>--font-serif</code> (Libre Caslon Condensed), <code>--font-mono</code> (JetBrains
        Mono), <code>--font-mark</code> (Bebas Neue). Control type scale uses{" "}
        <code>--input-font-size-*</code> (xs–xl) in <code>packages/apps/src/styles.css</code>.
      </p>
      <p style={{ marginBottom: "1rem" }}>
        To judge type on product chrome with cream/ink accents, use <strong>Branding</strong> — not
        a duplicate gallery here.
      </p>
      <div
        style={{
          display: "grid",
          gap: "0.75rem",
          padding: "1rem",
          border: "1px solid color-mix(in oklab, var(--color-ink) 12%, transparent)",
          borderRadius: "var(--control-radius, 0.5rem)",
        }}
      >
        <p style={{ fontFamily: "var(--font-sans)", margin: 0 }}>Sans — body / UI</p>
        <p style={{ fontFamily: "var(--font-serif)", margin: 0 }}>Serif — display / editorial</p>
        <p style={{ fontFamily: "var(--font-mono)", margin: 0 }}>Mono — code / data</p>
        <p style={{ fontFamily: "var(--font-mark)", margin: 0, fontSize: "1.5rem" }}>
          Mark — brand lockup
        </p>
      </div>
    </article>
  );
}

const meta = {
  title: "Foundations/Typography",
  component: TypographyOverview,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Short pointer at CSS font and control type tokens. Live chrome stays under Branding.",
      },
    },
  },
} satisfies Meta<typeof TypographyOverview>;

export default meta;
type Story = StoryObj<typeof TypographyOverview>;

export const Overview: Story = {};
