/**
 * Import-direction lint for `packages/apps/src` (#1632, #1638).
 *
 * Every top-level folder under `src/` is a module, and every module sits in
 * one layer. A file may import its own module, any module in a lower layer,
 * and any module in its own layer, except that one app package (`*-core`)
 * may import another only when the pair is on CORE_ALLOWLIST.
 *
 *   base       lib, types, assets — shared logic, no UI
 *   primitive  every other folder: shared UI and hooks, including the
 *              workspace-shell and workspace-app layout frames
 *   core       *-core — one package per app
 *   shell      wegotworkspace — router, routes and auth around the apps
 *
 * Files directly in `src/` (main.tsx, sw.ts, …) are entry points and are
 * not checked. Imports that leave `src/` or name an npm package are ignored.
 *
 * The layering and the allowlist are described in
 * .agents/skills/apps-ui/import-boundaries.md.
 */
import path from "node:path";

export const BASE_MODULES = Object.freeze(["lib", "types", "assets"]);
export const SHELL_MODULES = Object.freeze(["wegotworkspace"]);

const LAYER_RANK = Object.freeze({ base: 0, primitive: 1, core: 2, shell: 3 });

/**
 * One-way app-package imports that are part of the design. Every other
 * `*-core` → `*-core` import is reported. Remove an entry when the import
 * goes away; never add one without a reason a reviewer can check.
 */
export const CORE_ALLOWLIST = Object.freeze([
  {
    from: "docs-core",
    to: "drive-core",
    reason:
      "Docs documents are Drive files: the Docs home reuses Drive's file browser, lists and share dialog.",
  },
  ...["calendar-core", "docs-core", "drive-core", "meet-core", "notes-core"].map((from) => ({
    from,
    to: "text-editor-core",
    reason:
      "text-editor-core is the shared rich-text editor and collaboration layer (docs-collab) that apps embed.",
  })),
  ...["meet-core", "notifications-core"].map((from) => ({
    from,
    to: "presence-core",
    reason: "presence-core is the shared presence service that calls and the inbox build on.",
  })),
]);

const allowedCorePairs = new Set(CORE_ALLOWLIST.map(({ from, to }) => `${from}>${to}`));

/** @param {string} module */
export function layerOf(module) {
  if (BASE_MODULES.includes(module)) return "base";
  if (SHELL_MODULES.includes(module)) return "shell";
  if (module.endsWith("-core")) return "core";
  return "primitive";
}

/**
 * The top-level `src/` folder a specifier points at, or null when it points
 * outside `src/`, at a root file, or at an npm package.
 *
 * @param {string} specifier
 * @param {string} fromFile path of the importing file, relative to `src/`
 */
export function targetModule(specifier, fromFile) {
  let rel;
  if (specifier.startsWith("@/")) {
    rel = specifier.slice(2);
  } else if (specifier.startsWith("./") || specifier.startsWith("../")) {
    rel = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier));
    if (rel.startsWith("../")) return null;
  } else {
    return null;
  }
  const parts = rel.split("/");
  // `@/ui` is a folder's index; `../../styles.css` is a root file.
  if (parts.length === 1 && /\.[a-z]+$/i.test(parts[0])) return null;
  return parts[0] || null;
}

/**
 * Why `from` may not import `to`, or null when the import is allowed.
 *
 * @param {string} from
 * @param {string} to
 * @returns {"upward" | "crossCore" | null}
 */
export function violation(from, to) {
  if (from === to) return null;
  const fromLayer = layerOf(from);
  const toLayer = layerOf(to);
  if (LAYER_RANK[toLayer] > LAYER_RANK[fromLayer]) return "upward";
  if (fromLayer === "core" && toLayer === "core" && !allowedCorePairs.has(`${from}>${to}`)) {
    return "crossCore";
  }
  return null;
}

const DOC = "See .agents/skills/apps-ui/import-boundaries.md.";

// The `Import direction: a (x) may not import b (y).` prefix is parsed by
// scripts/lint-boundaries.mjs. Keep its shape.
const PREFIX = "Import direction: {{from}} ({{fromLayer}}) may not import {{to}} ({{toLayer}}).";

/** @type {import("eslint").Rule.RuleModule} */
export const importBoundariesRule = {
  meta: {
    type: "suggestion",
    docs: { description: "Enforce the import direction between modules in packages/apps/src." },
    schema: [
      {
        type: "object",
        properties: {
          srcRoot: { type: "string" },
          // Report every cross-module import as `edge`, for lint-boundaries.mjs.
          reportAll: { type: "boolean" },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      upward: `${PREFIX} A lower layer never imports a higher one: move the shared code down. ${DOC}`,
      edge: "Import edge: {{from}} ({{fromLayer}}) -> {{to}} ({{toLayer}}).",
      crossCore: `${PREFIX} App packages do not import each other unless the pair is on CORE_ALLOWLIST: move the shared code down into src/lib or a primitive. ${DOC}`,
    },
  },
  create(context) {
    const options = context.options[0] ?? {};
    const srcRoot = path.resolve(context.cwd, options.srcRoot ?? "src");
    const fromFile = path.relative(srcRoot, context.filename).split(path.sep).join("/");
    if (fromFile.startsWith("../") || !fromFile.includes("/")) return {};
    const from = fromFile.split("/")[0];

    /** @param {import("estree").Node | null | undefined} source */
    function check(source) {
      if (!source || source.type !== "Literal" || typeof source.value !== "string") return;
      const to = targetModule(source.value, fromFile);
      if (!to || to === from) return;
      const messageId = options.reportAll ? "edge" : violation(from, to);
      if (!messageId) return;
      context.report({
        node: source,
        messageId,
        data: { from, fromLayer: layerOf(from), to, toLayer: layerOf(to) },
      });
    }

    return {
      ImportDeclaration: (node) => check(node.source),
      ExportNamedDeclaration: (node) => check(node.source),
      ExportAllDeclaration: (node) => check(node.source),
      ImportExpression: (node) => check(node.source),
    };
  },
};

export const importBoundariesPlugin = {
  meta: { name: "wgw-import-boundaries" },
  rules: { "import-boundaries": importBoundariesRule },
};
