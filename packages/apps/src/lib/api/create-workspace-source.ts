declare const __WGW_MOCKS__: boolean | undefined;

/**
 * False in a production `vite build` of the app (`define` in `vite.config.ts`).
 * Gate every mock factory on it (`mocksInBuild ? createMock… : mocksNotInBuild`)
 * so Rollup drops the branch and its `@/lib/api/mock/*` imports from `dist`
 * (#1628). Dev, Vitest and Storybook keep the runtime mock/live switch.
 */
export const mocksInBuild: boolean = typeof __WGW_MOCKS__ === "undefined" ? true : __WGW_MOCKS__;

/** Stand-in for a mock factory in a build without mocks. `wgwLiveApiEnabled()` is true there, so it never runs. */
export function mocksNotInBuild(): never {
  throw new Error("This build has no mock data (see mocksInBuild in create-workspace-source.ts).");
}

export function createWorkspaceSource<TSource>({
  isLive,
  createLiveSource,
  createMockSource,
}: {
  isLive: boolean;
  createLiveSource: () => TSource;
  createMockSource: () => TSource;
}): TSource {
  return isLive ? createLiveSource() : createMockSource();
}
