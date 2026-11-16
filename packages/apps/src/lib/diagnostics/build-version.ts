declare const __WGW_BUILD_VERSION__: string | undefined;

/** Release version and commit of this client build (`vite.config.ts`); `dev` outside a Vite build. */
export function wgwBuildVersion(): string {
  return typeof __WGW_BUILD_VERSION__ === "string" && __WGW_BUILD_VERSION__.trim()
    ? __WGW_BUILD_VERSION__
    : "dev";
}
