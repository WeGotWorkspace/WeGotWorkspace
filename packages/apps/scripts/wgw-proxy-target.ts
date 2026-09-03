import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";

const wgwMonorepoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Default for Storybook / Vite dev+preview proxy — host PHP (`pnpm dev:api`) or Docker HTTP on :9080. */
export const DEFAULT_WGW_PROXY_TARGET = "http://127.0.0.1:9080";

/**
 * REST origin for `/api/v1` proxying. Reads repo-root `.env.local` (see `packages/apps/.env.example`).
 */
export function resolveWgwProxyTarget(mode = process.env.NODE_ENV ?? "development") {
  const env = loadEnv(mode, wgwMonorepoRoot, ["WGW_", "VITE_"]);
  const fromEnv = env.WGW_PROXY_TARGET?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_WGW_PROXY_TARGET;
}

/** Shared Vite dev/preview proxy for same-origin `/api/v1` → local API. */
export function wgwApiViteProxy(mode = process.env.NODE_ENV ?? "development") {
  const target = resolveWgwProxyTarget(mode);
  return {
    "/api/v1": {
      target,
      changeOrigin: true,
      secure: false,
      configure: (proxy: {
        on(
          event: "error",
          listener: (err: Error, req: IncomingMessage, res: ServerResponse) => void,
        ): void;
      }) => {
        proxy.on("error", (err: Error, _req: IncomingMessage, res: ServerResponse) => {
          if (res.headersSent) return;
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: `API proxy: backend unreachable at ${target}`,
              code: "proxy_backend_down",
              hint: `Start the API with \`pnpm dev:api\` and verify ${target}/api/v1/health`,
              detail: err.message,
            }),
          );
        });
      },
    },
  } as const;
}
