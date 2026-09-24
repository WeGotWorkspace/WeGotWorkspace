import path from "node:path";

const appsDir = "packages/apps";
const apiDir = "packages/api";

/** @param {string[]} files */
function toAppsRelative(files) {
  return files.map((file) => path.relative(appsDir, file)).filter((rel) => rel && !rel.startsWith(".."));
}

/** @param {string[]} files */
function toApiRelative(files) {
  return files.map((file) => path.relative(apiDir, file)).filter((rel) => rel && !rel.startsWith(".."));
}

/** @param {string[]} relPaths */
function quotePaths(relPaths) {
  return relPaths.map((rel) => `"${rel}"`).join(" ");
}

/** @type {import('lint-staged').Configuration} */
export default {
  [`${appsDir}/**/*.{ts,tsx,js,mjs,cjs}`]: (files) => {
    const rel = toAppsRelative(files);
    if (rel.length === 0) return [];
    const joined = quotePaths(rel);
    return [
      `pnpm --dir ${appsDir} exec prettier --write ${joined}`,
      `pnpm --dir ${appsDir} exec eslint --fix --no-warn-ignored ${joined}`,
    ];
  },
  [`${appsDir}/**/*.{css,json,md,yml,yaml,html}`]: (files) => {
    const rel = toAppsRelative(files);
    if (rel.length === 0) return [];
    return `pnpm --dir ${appsDir} exec prettier --write ${quotePaths(rel)}`;
  },
  [`${apiDir}/**/*.php`]: (files) => {
    const rel = toApiRelative(files);
    if (rel.length === 0) return [];
    return `packages/api/vendor/bin/pint ${quotePaths(rel.map((relPath) => path.join(apiDir, relPath)))}`;
  },
};
