/**
 * Sheets spike 5 only: the main dev config, plus one Yjs for the YCSV
 * prototype (prototypes/ycsv has its own node_modules; two Yjs copies break
 * every shared type). Serves /sheets-spike.html next to the app on one origin.
 */
import { defineConfig, mergeConfig, type ConfigEnv, type UserConfig } from "vite";
import base from "./vite.config";

export default defineConfig((env: ConfigEnv) =>
  mergeConfig((base as (e: ConfigEnv) => UserConfig)(env), {
    resolve: { dedupe: ["yjs", "y-protocols", "lib0"] },
  }),
);
