import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { writeMeetLowData } from "@/lib/meet-low-data";
import { SettingsMeetPane } from "@/settings-core/src/settings-meet-pane";
import { SettingsStoryScope } from "./settings-story-scope";

const meta = {
  title: "Features/Settings/Meet pane",
  component: SettingsMeetPane,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <SettingsStoryScope>
        <Story />
      </SettingsStoryScope>
    ),
  ],
} satisfies Meta<typeof SettingsMeetPane>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Low data mode off; the switch waits for Save. */
export const Default: Story = {
  beforeEach: () => {
    writeMeetLowData(false);
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const save = canvas.getByRole("button", { name: "Save" });
    await expect(save).toBeDisabled();
    await userEvent.click(canvas.getByRole("switch", { name: "Low data mode" }));
    await expect(save).toBeEnabled();
  },
};
