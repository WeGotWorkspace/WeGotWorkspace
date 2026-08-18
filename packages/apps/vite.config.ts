import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { wgwApiViteProxy } from "./scripts/wgw-proxy-target";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wgwMonorepoRoot = path.join(__dirname, "..", "..");

const DEFAULT_DEV_PORT = 5173;
const DEFAULT_PREVIEW_PORT = 4173;

function resolveWgwVitePort(raw: string | undefined, defaultPort: number, envVar: string): number {
  if (raw === undefined || raw.trim() === "") {
    return defaultPort;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    console.warn(`[vite] Ignoring invalid ${envVar}=${JSON.stringify(raw)}; using ${defaultPort}`);
    return defaultPort;
  }
  return parsed;
}

export default defineConfig(({ mode }) => {
  const wgwApiProxy = wgwApiViteProxy(mode);
  const wgwEnv = loadEnv(mode, wgwMonorepoRoot, "WGW_");
  const devPort = resolveWgwVitePort(
    wgwEnv.WGW_VITE_DEV_PORT,
    DEFAULT_DEV_PORT,
    "WGW_VITE_DEV_PORT",
  );
  const previewPort = resolveWgwVitePort(
    wgwEnv.WGW_VITE_PREVIEW_PORT,
    DEFAULT_PREVIEW_PORT,
    "WGW_VITE_PREVIEW_PORT",
  );

  return {
    // Absolute base so SPA deep links (e.g. /contacts/all/:id) resolve /assets/* correctly on refresh.
    base: "/",
    envDir: wgwMonorepoRoot,
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
      },
    },
    plugins: [
      react(),
      tailwindcss(),
      tsconfigPaths(),
      VitePWA({
        // Keep updates passive to avoid cross-tab reload/remount loops when two docs tabs are open.
        registerType: "prompt",
        injectRegister: false,
        devOptions: { enabled: false },
        workbox: {
          // Wait for tabs to close before activating a new worker (safer for local preview).
          skipWaiting: false,
          // Control the page on first SW activation so Chrome can offer install without a manual reload.
          clientsClaim: true,
          navigateFallback: "index.html",
          navigateFallbackDenylist: [/^\/api\//, /^\/apps\//],
          globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2,webmanifest}"],
          // Lit calendar CE graph is large; keep precache when the main chunk grows past 2 MiB.
          maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        },
        manifest: false,
      }),
    ],
    server: {
      // Bind all interfaces so both http://127.0.0.1 and http://localhost work (Node may otherwise listen on ::1 only).
      host: true,
      port: devPort,
      strictPort: true,
      proxy: wgwApiProxy,
    },
    preview: {
      port: previewPort,
      strictPort: true,
      proxy: wgwApiProxy,
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("scroll-timeline-polyfill")) {
              return "scroll-timeline";
            }
            if (
              id.includes("/docs-collab/docs-comments/") ||
              id.includes("/docs-collab/use-docs-comments")
            ) {
              return "docs-comments";
            }
            // Keep Lit calendar custom-element registration out of the main chunk.
            if (id.includes("/lib/calendar-elements/")) {
              return "calendar-elements";
            }
          },
        },
      },
    },
    publicDir: "public",
  };
});
