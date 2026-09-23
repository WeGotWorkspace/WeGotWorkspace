import type { Meta, StoryObj } from "@storybook/react-vite";
import { ColorsSheet } from "../colors-sheet";

/**
 * Interactive color token catalog. Live per-app knobs stay under Themes.
 */
const meta = {
  title: "Foundations/Colors",
  component: ColorsSheet,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Interactive catalog of brand primitives, semantic roles, and the shared workspace component contract. Values are read from computed CSS. Per-app accents live under Themes.",
      },
    },
  },
} satisfies Meta<typeof ColorsSheet>;

export default meta;
type Story = StoryObj<typeof ColorsSheet>;

export const Sheet: Story = {};
