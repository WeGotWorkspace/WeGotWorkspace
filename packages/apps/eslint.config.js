// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
import storybook from "eslint-plugin-storybook";

import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import unusedImports from "eslint-plugin-unused-imports";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", ".output"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
      "unused-imports": unusedImports,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "error",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: ["src/**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "fs",
              message: "Do not assert on source/CSS text. See .agents/skills/testing/test-first.md",
            },
            {
              name: "node:fs",
              message: "Do not assert on source/CSS text. See .agents/skills/testing/test-first.md",
            },
            {
              name: "fs/promises",
              message: "Do not assert on source/CSS text. See .agents/skills/testing/test-first.md",
            },
            {
              name: "node:fs/promises",
              message: "Do not assert on source/CSS text. See .agents/skills/testing/test-first.md",
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      "src/**/__tests__/fixtures/**",
      "src/**/pwa-*.test.ts",
      "src/**/workspace-pwa-manifests.test.ts",
      // Design-token invariants; replace with stylelint rules in a follow-up PR.
      "src/control-height.tokens.test.ts",
      "src/foundations/token-catalog.test.ts",
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  eslintPluginPrettier,
  storybook.configs["flat/recommended"],
);
