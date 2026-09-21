import type { Meta, StoryObj } from "@storybook/react-vite";
import { BrandLockup } from "../src/brand-lockup";
import "@/login-core/src/login-screen.css";
import "@/workspace-shell/src/workspace-shell-header.css";

const meta = {
  title: "Shared/Brand Lockup",
  component: BrandLockup,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof BrandLockup>;

export default meta;
type Story = StoryObj<typeof BrandLockup>;

/** Cream shell — dark `#003311` mark + ink wordmark (home / login / install). */
export const OnCream: Story = {
  render: () => (
    <main className="login-screen min-h-40">
      <header className="workspace-shell-header">
        <BrandLockup />
      </header>
    </main>
  ),
};
