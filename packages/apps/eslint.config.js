// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
import storybook from "eslint-plugin-storybook";

import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import unusedImports from "eslint-plugin-unused-imports";
import tseslint from "typescript-eslint";

// Frontend structure rules from #1642. Each message names the skill doc that
// states the rule; those docs link back here.

const WORKSPACE_NAVIGATION_DOC =
  "Workspace and controller files do not navigate: expose a callback prop (onLogout, onNavigate, …) and navigate in the route-level *App. See .agents/skills/workspace/SKILL.md (Navigation and logout).";

const BROWSER_GLOBAL = "/^(window|globalThis|self|document)$/";

const workspaceNavigationRules = {
  "no-restricted-globals": [
    "error",
    { name: "location", message: WORKSPACE_NAVIGATION_DOC },
    { name: "history", message: WORKSPACE_NAVIGATION_DOC },
  ],
  "no-restricted-syntax": [
    "error",
    // Any `window.location` use except reading `.origin`: building an absolute
    // URL is not navigation.
    {
      selector: `MemberExpression[property.name="location"][object.name=${BROWSER_GLOBAL}]:not(MemberExpression[property.name="origin"] > MemberExpression)`,
      message: WORKSPACE_NAVIGATION_DOC,
    },
    {
      selector: `MemberExpression[property.name="history"][object.name=${BROWSER_GLOBAL}]`,
      message: WORKSPACE_NAVIGATION_DOC,
    },
  ],
  "no-restricted-imports": [
    "error",
    {
      patterns: [
        {
          group: ["@tanstack/*router*", "@tanstack/*router*/**"],
          message: WORKSPACE_NAVIGATION_DOC,
        },
        { group: ["**/use-*-route-sync"], message: WORKSPACE_NAVIGATION_DOC },
        { group: ["**/wegotworkspace-router*"], message: WORKSPACE_NAVIGATION_DOC },
      ],
    },
  ],
};

const HTTP_CLIENT_DOC =
  "Panes and stories do not import the HTTP client: panes get bound slice handlers from operations, stories use mock fixtures from @/lib/api/mock. See .agents/skills/apps-ui/components.md (Dependency injection).";

const paneAndStoryImportRules = {
  "no-restricted-imports": [
    "error",
    {
      patterns: [
        // `@/lib/api/wgw/http` and relative paths to it.
        { group: ["**/wgw/http", "**/wgw/http.ts"], message: HTTP_CLIENT_DOC },
        // The `@/lib/api/wgw` barrel re-exports the HTTP client.
        { regex: "(^|/)lib/api/wgw(/index(\\.ts)?)?$", message: HTTP_CLIENT_DOC },
      ],
    },
  ],
};

const MESSAGE_CLASSIFICATION_DOC =
  "Classify a failure by its HTTP status, never by its message text: throw a typed error with a status field. See .agents/skills/client-transport/SKILL.md (Do not classify on the message).";

// `.message`, or the outbox's stored copy of it.
const MESSAGE_PROPERTY = "/^(message|lastError)$/";
// A local that holds the message text (`const message = error.message`).
const MESSAGE_LOCAL = "/^(message|msg|errorMessage|lastError|[a-z]+Message)$/";
const TEXT_METHOD = "/^(includes|startsWith|endsWith|match|matchAll|search|indexOf|lastIndexOf)$/";
const REGEX_METHOD = "/^(test|exec)$/";

const messageClassificationRules = {
  "no-restricted-syntax": [
    "error",
    // error.message.includes("503"), error.message?.startsWith(…)
    {
      selector: `CallExpression[callee.property.name=${TEXT_METHOD}][callee.object.property.name=${MESSAGE_PROPERTY}]`,
      message: MESSAGE_CLASSIFICATION_DOC,
    },
    // error.message.toLowerCase().includes(…)
    {
      selector: `CallExpression[callee.property.name=${TEXT_METHOD}][callee.object.type="CallExpression"][callee.object.callee.object.property.name=${MESSAGE_PROPERTY}]`,
      message: MESSAGE_CLASSIFICATION_DOC,
    },
    // /503/.test(error.message), /x/.test(row.lastError ?? "")
    {
      selector: `CallExpression[callee.property.name=${REGEX_METHOD}][arguments.0.property.name=${MESSAGE_PROPERTY}]`,
      message: MESSAGE_CLASSIFICATION_DOC,
    },
    {
      selector: `CallExpression[callee.property.name=${REGEX_METHOD}][arguments.0.type="LogicalExpression"][arguments.0.left.property.name=${MESSAGE_PROPERTY}]`,
      message: MESSAGE_CLASSIFICATION_DOC,
    },
    // const message = error.message; /x/.test(message), message.includes(…)
    {
      selector: `CallExpression[callee.property.name=${REGEX_METHOD}][arguments.0.name=${MESSAGE_LOCAL}]`,
      message: MESSAGE_CLASSIFICATION_DOC,
    },
    {
      selector: `CallExpression[callee.property.name=${TEXT_METHOD}][callee.object.name=${MESSAGE_LOCAL}]`,
      message: MESSAGE_CLASSIFICATION_DOC,
    },
  ],
};

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
      // Design-token invariants stay Vitest tests that read CSS, by decision in
      // #1642: see "Design-token tests" in .agents/skills/testing/test-first.md.
      "src/control-height.tokens.test.ts",
      "src/foundations/token-catalog.test.ts",
      "src/foundations/token-core.test.ts",
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  {
    files: ["src/**/*-workspace.tsx", "src/**/use-*-controller.{ts,tsx}"],
    rules: workspaceNavigationRules,
  },
  {
    files: ["src/**/*-pane.tsx", "src/**/*.stories.{ts,tsx}", "src/**/*.stories.*.{ts,tsx}"],
    rules: paneAndStoryImportRules,
  },
  {
    files: ["src/lib/api/**/*.{ts,tsx}", "src/lib/offline/**/*.{ts,tsx}"],
    ignores: ["src/**/*.test.{ts,tsx}", "src/**/__tests__/**"],
    rules: messageClassificationRules,
  },
  eslintPluginPrettier,
  storybook.configs["flat/recommended"],
);
