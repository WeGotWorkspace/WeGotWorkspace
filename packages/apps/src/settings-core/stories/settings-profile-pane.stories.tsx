import { useEffect, useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { SettingsProfilePane } from "@/settings-core/src/settings-profile-pane";
import {
  settingsProfileFormSchema,
  type SettingsProfileFormValues,
} from "@/settings-core/src/settings-profile-form-schema";
import { getProfileFormDefaults, getProfileStoryUsername } from "./settings-panes.stories.fixtures";
import { SettingsStoryScope } from "./settings-story-scope";

type ProfileStoryVariant = "default" | "dirtyIdentity" | "passwordFilled";

function ProfileStoryHarness({ variant = "default" }: { variant?: ProfileStoryVariant }) {
  const defaults = useMemo(() => getProfileFormDefaults(), []);
  const form = useForm<SettingsProfileFormValues>({
    resolver: zodResolver(settingsProfileFormSchema),
    defaultValues: defaults,
    mode: "onSubmit",
  });

  useEffect(() => {
    if (variant === "dirtyIdentity") {
      form.setValue("displayName", "Edited display name", { shouldDirty: true });
    }
    if (variant === "passwordFilled") {
      form.setValue("newPassword", "hunter2hunter", { shouldDirty: true });
      form.setValue("confirmPassword", "hunter2hunter", { shouldDirty: true });
    }
  }, [variant, form]);

  const profile = useMemo(
    () => ({
      username: getProfileStoryUsername(),
      form,
      saveProfile: form.handleSubmit(async () => {}),
    }),
    [form],
  );

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
  render: () => <ProfileStoryHarness variant="default" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const saveButton = canvas.getByRole("button", { name: "Save changes" });
    await expect(saveButton).toBeDisabled();
    const displayName = canvas.getByLabelText("Display name");
    await userEvent.clear(displayName);
    await userEvent.type(displayName, "Updated display name");
    await expect(saveButton).toBeEnabled();
  },
};

export const DirtyIdentity: Story = {
  render: () => <ProfileStoryHarness variant="dirtyIdentity" />,
};

export const PasswordFilled: Story = {
  render: () => <ProfileStoryHarness variant="passwordFilled" />,
};
