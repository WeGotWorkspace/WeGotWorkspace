import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: ["../src/stories/**/*.stories.tsx"],
  framework: {
    name: "@storybook/react-vite",
    options: { strictMode: false },
  },
  async viteFinal(config) {
    config.esbuild = { ...config.esbuild, keepNames: true };
    return config;
  },
};

export default config;
