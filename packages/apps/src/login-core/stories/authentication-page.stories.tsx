import { useState, type FormEvent } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { AuthenticationPage } from "@/login-core/src/authentication-page";
import { Button } from "@/button/src/button";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Input } from "@/ui/input";
import { shareLabels } from "@/share-ui/share-labels";
import { SharePublicView } from "@/share-ui/share-public-view";

function PasswordProtectedHarness({ initialError = "" }: { initialError?: string }) {
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState(initialError);
  const [submitting, setSubmitting] = useState(false);

  const onPasswordSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setErrorMessage("");
    window.setTimeout(() => {
      setSubmitting(false);
      setErrorMessage(shareLabels.publicLinkPasswordRequired);
    }, 400);
  };

  return (
    <SharePublicView
      phase="password"
      password={password}
      errorMessage={errorMessage}
      submitting={submitting}
      onPasswordChange={setPassword}
      onPasswordSubmit={onPasswordSubmit}
    />
  );
}

const meta = {
  title: "Shared/AuthenticationPage",
  component: AuthenticationPage,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof AuthenticationPage>;

export default meta;
type Story = StoryObj<typeof AuthenticationPage>;

export const Default: Story = {
  args: {
    title: "Welcome back.",
  },
  render: (args) => (
    <AuthenticationPage {...args}>
      <form className="space-y-2" onSubmit={(event) => event.preventDefault()}>
        <FieldLabelRow label="Username">
          <Input id="story-username" name="username" placeholder="yourname" />
        </FieldLabelRow>
        <FieldLabelRow label="Password">
          <Input id="story-password" name="password" type="password" placeholder="••••••••" />
        </FieldLabelRow>
        <div className="pt-4">
          <Button
            type="submit"
            label="Sign in"
            variant="primary"
            size="lg"
            pill
            className="login-screen__submit"
          />
        </div>
      </form>
    </AuthenticationPage>
  ),
};

export const TitleAndHint: Story = {
  args: {
    title: "This link is password protected",
  },
  render: (args) => (
    <AuthenticationPage {...args}>
      <p className="login-screen__hint mb-5 text-sm">
        Enter the password shared with you to continue.
      </p>
    </AuthenticationPage>
  ),
};

/** Share public-link composition (`SharePublicView`) — password gate. */
export const SharePasswordProtected: Story = {
  name: "Share / Password protected",
  render: () => <PasswordProtectedHarness />,
};

export const SharePasswordProtectedInvalid: Story = {
  name: "Share / Password protected (invalid)",
  render: () => <PasswordProtectedHarness initialError={shareLabels.publicLinkPasswordRequired} />,
};

export const ShareOpening: Story = {
  name: "Share / Opening",
  render: () => <SharePublicView phase="loading" />,
};

export const ShareDownloadStarted: Story = {
  name: "Share / Download started",
  render: () => <SharePublicView phase="downloaded" />,
};

export const ShareUnavailable: Story = {
  name: "Share / Unavailable",
  render: () => (
    <SharePublicView phase="error" errorMessage="This share link is no longer available." />
  ),
};

export const ShareMissingToken: Story = {
  name: "Share / Missing token",
  render: () => <SharePublicView phase="error" errorMessage={shareLabels.publicLinkMissingToken} />,
};
