import type { Meta, StoryObj } from "@storybook/react-vite";

/**
 * Docs-only pointer at CSS color tokens. Live knobs stay under Branding.
 * Source: `packages/apps/src/styles.css` (`--color-*`, cream/ink, brand primitives).
 */
function ColorsOverview() {
  return (
    <article style={{ maxWidth: "40rem", fontFamily: "var(--font-sans)", lineHeight: 1.5 }}>
      <h1 style={{ fontFamily: "var(--font-mark)", fontSize: "1.75rem", marginBottom: "0.5rem" }}>
        Colors
      </h1>
      <p
        style={{
          marginBottom: "1rem",
          color: "color-mix(in oklab, var(--color-ink) 70%, transparent)",
        }}
      >
        Semantic and brand color tokens live on <code>:root</code> / <code>@theme</code> in{" "}
        <code>packages/apps/src/styles.css</code> — for example <code>--color-ink</code>,{" "}
        <code>--color-cream</code>, <code>--color-we-got-*</code>, and status roles (
        <code>--color-error</code>, <code>--color-warning</code>, <code>--color-success</code>).
      </p>
      <p style={{ marginBottom: "1rem" }}>
        For live accent / cream / ink knobs on real app chrome, open the designer catalog under{" "}
        <strong>Branding</strong> (Mail, Home, Login, Installer, …). Do not duplicate that chrome
        here.
      </p>
      <ul style={{ paddingLeft: "1.25rem" }}>
        <li>
          <a href="/?path=/story/branding-home--default">Branding/Home</a>
        </li>
        <li>
          <a href="/?path=/story/branding-login--login">Branding/Login</a>
        </li>
        <li>
          <a href="/?path=/story/branding-mail--default">Branding/Mail</a>
        </li>
      </ul>
    </article>
  );
}

const meta = {
  title: "Foundations/Colors",
  component: ColorsOverview,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Short pointer at CSS color tokens. Live cream/ink/accent knobs stay under Branding.",
      },
    },
  },
} satisfies Meta<typeof ColorsOverview>;

export default meta;
type Story = StoryObj<typeof ColorsOverview>;

export const Overview: Story = {};
