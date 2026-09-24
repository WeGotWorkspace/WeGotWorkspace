import { fileURLToPath } from "node:url";
import path from "node:path";
import chokidar from "chokidar";
import { generateOpenApiDomainTypes } from "./typegen-openapi-types.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(packageRoot, "../..");

const watchPaths = [
  path.resolve(repoRoot, "packages/api/openapi/openapi.json"),
  path.resolve(repoRoot, "packages/api/openapi/schemas"),
];

let running = false;
let queued = false;
let queuedReason = "queued";

async function runTypegen(reason) {
  if (running) {
    queued = true;
    queuedReason = reason;
    return;
  }

  running = true;
  const startedAt = Date.now();
  process.stdout.write(`[typegen:openapi:watch] Regenerating (${reason})...\n`);
  try {
    await generateOpenApiDomainTypes();
    process.stdout.write(
      `[typegen:openapi:watch] Done in ${Date.now() - startedAt}ms (${reason}).\n`,
    );
  } catch (error) {
    process.stderr.write(
      `[typegen:openapi:watch] Failed (${reason}): ${error instanceof Error ? error.message : String(error)}\n`,
    );
  } finally {
    running = false;
    if (queued) {
      const nextReason = queuedReason;
      queued = false;
      queuedReason = "queued";
      await runTypegen(nextReason);
    }
  }
}

await runTypegen("startup");

const watcher = chokidar.watch(watchPaths, {
  ignoreInitial: true,
  awaitWriteFinish: {
    stabilityThreshold: 150,
    pollInterval: 50,
  },
});

watcher.on("all", (eventName, filePath) => {
  void runTypegen(`${eventName}:${path.relative(packageRoot, filePath)}`);
});

process.on("SIGINT", async () => {
  await watcher.close();
  process.exit(0);
});

