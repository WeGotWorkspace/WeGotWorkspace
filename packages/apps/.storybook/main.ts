import path from "node:path";
import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/react-vite";
import { resolveWgwProxyTarget } from "../scripts/wgw-proxy-target";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appsRoot = path.join(__dirname, "..");
const wgwMonorepoRoot = path.join(__dirname, "..", "..", "..");
const wgwProxyTarget = resolveWgwProxyTarget();

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(js|jsx|mjs|ts|tsx)"],
  addons: [
    "@chromatic-com/storybook",
    "@storybook/addon-a11y",
    "@storybook/addon-docs",
    "@storybook/addon-vitest",
    "@ljcl/storybook-addon-cssprops",
  ],
  framework: {
    name: "@storybook/react-vite",
    options: {
      builder: {
        viteConfigPath: false,
      },
    },
  },
  docs: {
    autodocs: "tag",
  },
  typescript: {
    reactDocgen: "react-docgen-typescript",
    reactDocgenTypescriptOptions: {
      shouldExtractLiteralValuesFromEnum: true,
      propFilter: (prop) => (prop.parent ? !/node_modules/.test(prop.parent.fileName) : true),
    },
  },
  async viteFinal(baseConfig) {
    return {
      ...baseConfig,
      plugins: [...(baseConfig.plugins ?? [])],
      /** Load `VITE_*` / `WGW_*` from monorepo root `.env.local` (see `packages/apps/.env.example`). */
      envDir: wgwMonorepoRoot,
      server: {
        ...baseConfig.server,
        proxy: {
          ...baseConfig.server?.proxy,
          "/api/v1": {
            target: wgwProxyTarget,
            changeOrigin: true,
            secure: false,
          },
        },
      },
      resolve: {
        ...(baseConfig.resolve ?? {}),
        alias: {
          ...(baseConfig.resolve && "alias" in baseConfig.resolve && baseConfig.resolve.alias
            ? baseConfig.resolve.alias
            : {}),
          "@": path.join(appsRoot, "src"),
          "@wgw-api-generated": path.join(wgwMonorepoRoot, "packages/api/openapi/generated"),
        },
      },
    };
  },
};
export default config;
