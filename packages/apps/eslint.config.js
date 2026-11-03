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

const IMPORT_DIRECTION_DOC =
  "Import direction: src/lib sits below every *-core package, and two app packages do not import each other. Move the shared code down into src/lib or a shared package. See #1642.";

// Tests only. Panes, workspaces, controllers and stories are checked too: the
// direction rules use `@typescript-eslint/no-restricted-imports`, a separate
// rule from the error-level core `no-restricted-imports` those files carry, so
// neither replaces the other's options.
const DIRECTION_IGNORES = ["src/**/*.test.{ts,tsx}", "src/**/__tests__/**"];

// `lib/` must not import a `*-core` package. Baseline when the rule was added:
// 106 non-test files under src/lib. It is `warn` so lint stays green; the count
// must only go down.
const libImportDirectionRule = {
  "@typescript-eslint/no-restricted-imports": [
    "warn",
    {
      patterns: [{ regex: "^(@/|(\\.\\./)+)[a-z-]+-core(/|$)", message: IMPORT_DIRECTION_DOC }],
    },
  ],
};

// App packages that import each other in both directions today. A one-way
// import is allowed. Baseline (non-test files, panes, workspaces,
// controllers and stories included, importing the other package):
//   calendar-core 3 <-> meet-core 13
//   calendar-core 5 <-> tasks-core 3
//   docs-core 27 <-> drive-core 3
//   docs-core 9 <-> text-editor-core 36
//   drive-core 2 <-> text-editor-core 6
//   meet-core 1 <-> settings-core 1
// Break a cycle by removing one direction, then drop the pair from this list.
const TWO_WAY_PAIRS = [
  ["calendar-core", "meet-core"],
  ["calendar-core", "tasks-core"],
  ["docs-core", "drive-core"],
  ["docs-core", "text-editor-core"],
  ["drive-core", "text-editor-core"],
  ["meet-core", "settings-core"],
];

const forbiddenByPackage = new Map();
for (const [a, b] of TWO_WAY_PAIRS) {
  forbiddenByPackage.set(a, [...(forbiddenByPackage.get(a) ?? []), b]);
  forbiddenByPackage.set(b, [...(forbiddenByPackage.get(b) ?? []), a]);
}

// One block per package, so blocks never replace each other's options.
const crossPackageBlocks = [...forbiddenByPackage].map(([pkg, others]) => ({
  files: [`src/${pkg}/**/*.{ts,tsx}`],
  ignores: DIRECTION_IGNORES,
  rules: {
    "@typescript-eslint/no-restricted-imports": [
      "warn",
      {
        patterns: others.map((other) => ({
          group: [`@/${other}`, `@/${other}/**`],
          message: IMPORT_DIRECTION_DOC,
        })),
      },
    ],
  },
}));

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
  {
    files: ["src/lib/**/*.{ts,tsx}"],
    ignores: DIRECTION_IGNORES,
    rules: libImportDirectionRule,
  },
  ...crossPackageBlocks,
  eslintPluginPrettier,
  storybook.configs["flat/recommended"],
);
