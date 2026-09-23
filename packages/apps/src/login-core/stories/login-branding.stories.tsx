import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { createBrandingStoryMeta } from "@/branding-playground";
import { ForgotPasswordScreen } from "@/login-core/src/forgot-password-screen";
import { LoginScreen } from "@/login-core/src/login-screen";
import { ResetPasswordScreen } from "@/login-core/src/reset-password-screen";

const brandingMeta = createBrandingStoryMeta({
  appId: "auth",
  workspaceClass: "login-screen",
  parameters: {
    routerPath: "/login",
    docs: {
      description: {
        component:
          "Designer branding for the cream auth shell: `--color-we-got-soft` / `--color-we-got-dark` via cssprops, " +
          "and BrandLockup suite-mark SVG slot (`iconPreset` / `svgMarkup`). " +
          "No per-app accent — production login uses the same paper as home, not `--workspace-home-bg`. " +
          "State matrix: sign-in (recovery on/off), connect-assistant return path, forgot success, reset form / invalid token.",
      },
    },
  },
});

const meta = {
  ...brandingMeta,
  title: "Themes/Login",
  tags: ["vitest-ci"],
} satisfies Meta;

export default meta;
type Story = StoryObj;

/** Production login — cream paper, BrandLockup, recovery link on. */
export const Default: Story = {
  name: "Login",
  parameters: {
    routerPath: "/login",
  },
  render: () => <LoginScreen passwordRecoveryEnabled />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText(/© .*WeGotWorkspace/)).toBeNull();
    await expect(canvas.getByRole("button", { name: "Sign in" })).toBeTruthy();
  },
};

export const ConnectAssistant: Story = {
  name: "Connect Assistant",
  parameters: {
    routerPath: "/login?return=%2Foauth%2Fauthorize",
    docs: {
      description: {
        story:
          "Same login screen as Login, with `return=/oauth/authorize` (MCP assistant connect). Live `/oauth/session` redirects here.",
      },
    },
  },
  render: () => <LoginScreen returnPath="/oauth/authorize" passwordRecoveryEnabled />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Connect Assistant" })).toBeTruthy();
    await expect(canvas.queryByText("Welcome back.")).toBeNull();
    await expect(canvas.getByRole("button", { name: "Sign in" })).toBeTruthy();
  },
};

export const RecoveryOff: Story = {
  name: "Recovery off",
  parameters: {
    routerPath: "/login",
  },
  render: () => <LoginScreen passwordRecoveryEnabled={false} />,
};

export const ForgotRequestSuccess: Story = {
  name: "Forgot / request success",
  parameters: {
    routerPath: "/login/forgot",
  },
  render: () => <ForgotPasswordScreen />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const fetchMock = fn(() =>
      Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
    const previousFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof globalThis.fetch;
    try {
      await userEvent.type(canvas.getByLabelText("Username or email"), "alice@example.test");
      await userEvent.click(canvas.getByRole("button", { name: "Send reset link" }));
      await waitFor(() =>
        expect(
          canvas.getByText(
            /if an account matches that username or email, a reset message was submitted/i,
          ),
        ).toBeInTheDocument(),
      );
    } finally {
      globalThis.fetch = previousFetch;
    }
  },
};

export const ResetForm: Story = {
  name: "Reset / form",
  parameters: {
    routerPath: "/login/reset?token=story-token",
  },
  render: () => <ResetPasswordScreen token="story-token" />,
};

export const ResetInvalidToken: Story = {
  name: "Reset / invalid token",
  parameters: {
    routerPath: "/login/reset",
  },
  render: () => <ResetPasswordScreen token="" />,
};
