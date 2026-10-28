import type { Meta, StoryObj } from "@storybook/react-vite";
import type { DriveShareAccess, DriveShareAtPath } from "@wgw/openapi-types/drive-types";
import { expect, fn, screen, userEvent, within } from "storybook/test";
import { DriveStoryScope } from "@/drive-core/stories/drive-story-scope";
import { mockDriveShareAtPath } from "@/lib/api/mock/drive-share-fixtures";
import { ShareGuestSection } from "@/share-ui/share-guest-section";
import type { ShareMutations } from "@/share-ui/use-share-mutations";

const SHARE_ID = "guest-story-share";
const GUEST_ACCESS: DriveShareAccess[] = ["view", "comment", "edit", "full"];

/** One accepted guest grant per level, in picker order. */
const atPath: DriveShareAtPath = {
  ...mockDriveShareAtPath,
  effectiveGrants: GUEST_ACCESS.map((access) => ({
    principal: `${access}@example.com`,
    principalType: "email" as const,
    access,
    source: mockDriveShareAtPath.effectiveGrants[0]!.source,
    removal: {
      method: "patchShareWith" as const,
      shareId: SHARE_ID,
      principal: `${access}@example.com`,
    },
  })),
};

function createMutations(): ShareMutations {
  return {
    inviteGuest: fn(async () => undefined),
    updateGrantAccess: fn(async () => undefined),
    removeGuestInvite: fn(async () => undefined),
  } as unknown as ShareMutations;
}

const mutations = createMutations();

const meta = {
  title: "Features/Share/GuestSection",
  component: ShareGuestSection,
  render: (args) => (
    <DriveStoryScope className="max-w-xl p-6">
      <ShareGuestSection {...args} />
    </DriveStoryScope>
  ),
} satisfies Meta<typeof ShareGuestSection>;

export default meta;
type Story = StoryObj<typeof ShareGuestSection>;

async function optionLabels(trigger: HTMLElement): Promise<string[]> {
  await userEvent.click(trigger);
  const options = await screen.findAllByRole("option");
  const labels = options.map((option) => option.textContent?.trim() ?? "");
  await userEvent.keyboard("{Escape}");
  return labels;
}

/**
 * Guests cannot comment, edit or upload yet (#1715), so a new invite offers
 * only view. Older grants keep their level and can only be lowered.
 */
export const PickerLevels: Story = {
  tags: ["vitest-ci"],
  args: { atPath, mutations },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const [viewGrant, commentGrant, editGrant, fullGrant, invite] = canvas.getAllByRole("combobox");

    await expect(await optionLabels(invite!)).toEqual(["Can view"]);
    await expect(await optionLabels(viewGrant!)).toEqual(["Can view"]);
    await expect(await optionLabels(commentGrant!)).toEqual(["Can view", "Can comment"]);
    await expect(await optionLabels(editGrant!)).toEqual(["Can view", "Can comment", "Can edit"]);
    await expect(await optionLabels(fullGrant!)).toEqual([
      "Can view",
      "Can comment",
      "Can edit",
      "Full access",
    ]);

    await userEvent.click(editGrant!);
    await userEvent.click(await screen.findByRole("option", { name: "Can view" }));
    await expect(mutations.updateGrantAccess).toHaveBeenCalledWith(
      SHARE_ID,
      "edit@example.com",
      "view",
    );
  },
};
