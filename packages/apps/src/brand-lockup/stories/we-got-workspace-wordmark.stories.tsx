import type { Meta, StoryObj } from "@storybook/react-vite";
import { WeGotWorkspaceWordmark } from "../src/we-got-workspace-wordmark";
import "@/login-core/src/login-screen.css";
import "@/workspace-shell/src/workspace-shell-header.css";

const meta = {
  title: "Layout/Brand Lockup/We Got Workspace Wordmark",
  component: WeGotWorkspaceWordmark,
  parameters: {
    layout: "centered",
  },
  argTypes: {
    className: { control: "text" },
  },
} satisfies Meta<typeof WeGotWorkspaceWordmark>;

export default meta;
type Story = StoryObj<typeof WeGotWorkspaceWordmark>;

/** Standalone suite wordmark — inherits `currentColor` from the parent. */
export const Default: Story = {
  render: (args) => (
    <div className="login-screen p-8 text-[var(--app-switch-label-color,currentColor)]">
      <WeGotWorkspaceWordmark {...args} />
    </div>
  ),
};

/** Wordmark as used in the auth / home header lockup. */
export const InHeader: Story = {
  render: () => (
    <main className="login-screen min-h-40">
      <header className="workspace-shell-header flex items-center px-4">
        <WeGotWorkspaceWordmark />
      </header>
    </main>
  ),
  parameters: {
    layout: "fullscreen",
  },
};
