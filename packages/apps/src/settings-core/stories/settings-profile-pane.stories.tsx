import { useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { createSettingsAppBootstrap } from "@/lib/api/mock/settings-bootstrap";
import type { SettingsAPIOperations } from "@/lib/models/settings-types";
import { SettingsProfilePane } from "@/settings-core/src/settings-profile-pane";
import { useSettingsProfileForm } from "@/settings-core/src/use-settings-profile-form";
import { getProfileStoryUser } from "./settings-panes.stories.fixtures";
import { SettingsStoryScope } from "./settings-story-scope";

function ProfileStoryHarness() {
  const user = useMemo(() => getProfileStoryUser(), []);
  const operations = useMemo<SettingsAPIOperations>(
    () => ({ saveProfile: async () => createSettingsAppBootstrap().data }),
    [],
  );
  const profile = useSettingsProfileForm({
    user,
    operations,
    countUnsyncedChanges: async () => 0,
  });

  return (
    <SettingsStoryScope>
      <SettingsProfilePane profile={profile} />
    </SettingsStoryScope>
  );
}

const meta = {
  title: "Features/Settings/Panes/Profile",
  component: SettingsProfilePane,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof SettingsProfilePane>;

export default meta;
type Story = StoryObj<typeof SettingsProfilePane>;

export const Default: Story = {
  tags: ["vitest-ci"],
  render: () => <ProfileStoryHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByLabelText("Display name")).toBeEnabled();
    await expect(canvas.getByText("Security")).toBeVisible();
  },
};

export const ChangeEmail: Story = {
  tags: ["vitest-ci"],
  render: () => <ProfileStoryHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const [emailChange] = canvas.getAllByRole("button", { name: "Change" });
    await userEvent.click(emailChange);
    const body = within(canvasElement.ownerDocument.body);
    const currentPassword = await body.findByLabelText("Current password");
    await expect(currentPassword).toHaveAttribute("autocomplete", "current-password");
  },
};

export const ChangePassword: Story = {
  render: () => <ProfileStoryHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const [, passwordChange] = canvas.getAllByRole("button", { name: "Change" });
    await userEvent.click(passwordChange);
    const body = within(canvasElement.ownerDocument.body);
    await expect(await body.findByLabelText("New password")).toBeVisible();
  },
};
