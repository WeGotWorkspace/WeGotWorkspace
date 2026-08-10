import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WeGotWorkspaceApp } from "@/wegotworkspace/src/wegotworkspace-app";
import "@/styles.css";

const SW_REFRESHING_KEY = "wgw-sw-refreshing";

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  void import("virtual:pwa-register").then(({ registerSW }) => {
    const isLocalPreview = location.hostname === "localhost" || location.hostname === "127.0.0.1";

    // Clear anti-loop flag after settle so a later deploy can refresh again.
    try {
      if (sessionStorage.getItem(SW_REFRESHING_KEY) === "1") {
        window.setTimeout(() => {
          try {
            sessionStorage.removeItem(SW_REFRESHING_KEY);
          } catch {
            // ignore
          }
        }, 10_000);
      }
    } catch {
      // ignore
    }

    const updateSW = registerSW({
      immediate: true,
      /** Local preview: never auto-reload when a new worker activates (avoids reload loops). */
      onNeedReload() {
        if (!isLocalPreview) {
          window.location.reload();
        }
      },
      /**
       * Activate the waiting worker once. Reloading alone never skipWaiting()s, so
       * production used to loop. sessionStorage blocks DevTools "Update on reload" spins.
       */
      onNeedRefresh() {
        if (isLocalPreview) return;
        try {
          if (sessionStorage.getItem(SW_REFRESHING_KEY) === "1") {
            return;
          }
          sessionStorage.setItem(SW_REFRESHING_KEY, "1");
        } catch {
          // storage unavailable — still attempt one activation
        }
        void updateSW(true);
      },
    });
  });
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Missing #root element");
}

createRoot(rootElement).render(
  <StrictMode>
    <WeGotWorkspaceApp />
  </StrictMode>,
);
