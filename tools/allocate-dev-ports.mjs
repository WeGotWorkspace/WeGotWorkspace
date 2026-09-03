#!/usr/bin/env node
/**
 * Pick free loopback ports for a second (or Nth) `pnpm dev` on the same machine.
 * Prints `export KEY=value` lines on stdout for `eval "$(node tools/allocate-dev-ports.mjs)"`.
 */
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_DEV_PORTS = {
  vite: 5173,
  preview: 4173,
  storybook: 6006,
  php: 9080,
};

const MAX_ATTEMPTS = 50;

export function parsePort(raw) {
  if (raw === undefined || raw === null) return null;
  const text = String(raw).trim();
  if (text === "") return null;
  const parsed = Number(text);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) return null;
  return parsed;
}

/** Loopback `http(s)://host:port` only — Docker vhosts are left to `WGW_PHP_DEV_PORT`. */
export function phpPortFromProxyTarget(target) {
  const text = String(target ?? "").trim();
  if (text === "") return null;
  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost") return null;
  if (url.port) return parsePort(url.port);
  return url.protocol === "https:" ? 443 : 80;
}

function tryListen(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    const finish = (free) => {
      server.removeAllListeners();
      try {
        server.close();
      } catch {
        // already closed
      }
      resolve(free);
    };
    server.once("error", (err) => {
      if (err && (err.code === "EADDRINUSE" || err.code === "EACCES")) {
        finish(false);
        return;
      }
      // IPv6 disabled, etc. — this host cannot occupy the port.
      finish(true);
    });
    server.listen({ port, host, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

export async function isPortFree(port) {
  for (const host of ["127.0.0.1", "0.0.0.0", "::1", "::"]) {
    const free = await tryListen(port, host);
    if (!free) return false;
  }
  return true;
}

export async function nextFreePort(preferred, { attempts = MAX_ATTEMPTS, exclude = new Set() } = {}) {
  const start = preferred;
  for (let i = 0; i < attempts; i += 1) {
    const port = start + i;
    if (port > 65535) break;
    if (exclude.has(port)) continue;
    if (await isPortFree(port)) return port;
  }
  throw new Error(`No free TCP port in ${start}–${Math.min(65535, start + attempts - 1)}`);
}

export async function allocateDevPorts(env = process.env) {
  const vitePreferred = parsePort(env.WGW_VITE_DEV_PORT) ?? DEFAULT_DEV_PORTS.vite;
  const previewPreferred = parsePort(env.WGW_VITE_PREVIEW_PORT) ?? DEFAULT_DEV_PORTS.preview;
  const storyPreferred = parsePort(env.WGW_STORYBOOK_PORT) ?? DEFAULT_DEV_PORTS.storybook;
  const phpPreferred =
    parsePort(env.WGW_PHP_DEV_PORT) ??
    phpPortFromProxyTarget(env.WGW_PROXY_TARGET) ??
    DEFAULT_DEV_PORTS.php;

  const used = new Set();
  const vite = await nextFreePort(vitePreferred, { exclude: used });
  used.add(vite);
  const preview = await nextFreePort(previewPreferred, { exclude: used });
  used.add(preview);
  const storybook = await nextFreePort(storyPreferred, { exclude: used });
  used.add(storybook);
  const php = await nextFreePort(phpPreferred, { exclude: used });

  return {
    WGW_VITE_DEV_PORT: String(vite),
    WGW_VITE_PREVIEW_PORT: String(preview),
    WGW_STORYBOOK_PORT: String(storybook),
    WGW_PHP_DEV_PORT: String(php),
    WGW_PROXY_TARGET: `http://127.0.0.1:${php}`,
    preferred: {
      vite: vitePreferred,
      preview: previewPreferred,
      storybook: storyPreferred,
      php: phpPreferred,
    },
  };
}

function printBanner(ports) {
  const lines = [
    "WeGotWorkspace dev ports:",
    `  App        http://127.0.0.1:${ports.WGW_VITE_DEV_PORT}`,
    `  Storybook  http://127.0.0.1:${ports.WGW_STORYBOOK_PORT}`,
    `  API        ${ports.WGW_PROXY_TARGET}`,
  ];
  const shifted = [];
  if (Number(ports.WGW_VITE_DEV_PORT) !== ports.preferred.vite) {
    shifted.push(`5173-range → ${ports.WGW_VITE_DEV_PORT}`);
  }
  if (Number(ports.WGW_STORYBOOK_PORT) !== ports.preferred.storybook) {
    shifted.push(`6006-range → ${ports.WGW_STORYBOOK_PORT}`);
  }
  if (Number(ports.WGW_PHP_DEV_PORT) !== ports.preferred.php) {
    shifted.push(`9080-range → ${ports.WGW_PHP_DEV_PORT}`);
  }
  if (shifted.length > 0) {
    lines.push(`  (defaults busy; using ${shifted.join(", ")})`);
  }
  process.stderr.write(`${lines.join("\n")}\n`);
}

function isCli() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isCli()) {
  const ports = await allocateDevPorts();
  for (const key of [
    "WGW_VITE_DEV_PORT",
    "WGW_VITE_PREVIEW_PORT",
    "WGW_STORYBOOK_PORT",
    "WGW_PHP_DEV_PORT",
    "WGW_PROXY_TARGET",
  ]) {
    process.stdout.write(`export ${key}=${ports[key]}\n`);
  }
  printBanner(ports);
}
