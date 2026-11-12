import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { VitePWA } from "vite-plugin-pwa";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { isShellPrecacheEntry, shellAssetUrls } from "./src/lib/offline/precache-shell";
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

export default defineConfig(({ command, mode }) => {
  const wgwApiProxy = wgwApiViteProxy(mode);
  const wgwEnv = loadEnv(mode, wgwMonorepoRoot, "WGW_");
  // A production app build drops every mock factory gated on `mocksInBuild`
  // (#1628). Storybook overrides this in `.storybook/main.ts`. Building with
  // VITE_WGW_USE_LIVE_API=0 keeps the mocks, as before.
  const viteEnv = loadEnv(mode, wgwMonorepoRoot, "VITE_");
  const mockApiRequested = /^(0|false|no|off)$/i.test(viteEnv.VITE_WGW_USE_LIVE_API?.trim() ?? "");
  const mocksInBuild = !(command === "build" && mode === "production" && !mockApiRequested);
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
    define: {
      __WGW_MOCKS__: JSON.stringify(mocksInBuild),
    },
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
        // Custom SW so push/notificationclick can run; generateSW cannot host those handlers.
        strategies: "injectManifest",
        srcDir: "src",
        filename: "sw.ts",
        // Keep updates passive to avoid cross-tab reload/remount loops when two docs tabs are open.
        registerType: "prompt",
        injectRegister: false,
        // Localhost is a secure origin: enable the injectManifest SW so VAPID
        // push works on `pnpm dev`. type: "module" is required for the TS SW.
        // navigateFallback stays unset so the dev precache is empty.
        devOptions: { enabled: true, type: "module" },
        injectManifest: {
          // No webmanifest. The document requests `/manifests/{app}.webmanifest?v=`,
          // so an unversioned precache entry would never match.
          globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2,mp3}"],
          maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
          // Precache the shell only (#1628): what index.html loads. Lazy app
          // chunks are cached by src/sw.ts when their route first requests them.
          manifestTransforms: [
            (entries) => {
              const indexPath = path.join(__dirname, "dist", "index.html");
              if (!existsSync(indexPath)) return { manifest: entries, warnings: [] };
              const shell = shellAssetUrls(readFileSync(indexPath, "utf8"));
              return {
                manifest: entries.filter((entry) => isShellPrecacheEntry(entry.url, shell)),
                warnings: [],
              };
            },
          ],
        },
        manifest: false,
      }),
    ],
    optimizeDeps: {
      // The dep scan misses these: `virtual:pwa-register` (a dynamic import in
      // main.tsx) pulls in workbox-window, and the dev service worker (src/sw.ts)
      // is not a scan entry. Found on first load, they make Vite reload the page
      // twice, which drops whatever the user (or an e2e test) was typing.
      include: ["workbox-window", "workbox-core", "workbox-precaching", "workbox-routing"],
    },
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
        // Demo modules only build data; once their factories are gated off
        // (`mocksInBuild`), nothing should keep them alive for their top-level code.
        treeshake: {
          moduleSideEffects: (id) => !id.includes("/src/lib/api/mock/"),
        },
        output: {
          manualChunks(id) {
            if (id.includes("scroll-timeline-polyfill")) {
              return "scroll-timeline";
            }
          },
        },
      },
    },
    publicDir: "public",
  };
});
