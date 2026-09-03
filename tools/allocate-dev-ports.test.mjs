import assert from "node:assert/strict";
import net from "node:net";
import { test } from "node:test";
import {
  allocateDevPorts,
  isPortFree,
  nextFreePort,
  parsePort,
  phpPortFromProxyTarget,
} from "./allocate-dev-ports.mjs";

function listenOn(port, host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen({ host, port, exclusive: true }, () => resolve(server));
  });
}

function listen(host) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen({ host, port: 0, exclusive: true }, () => {
      const address = server.address();
      resolve({ server, port: address.port });
    });
  });
}

test("parsePort accepts integers in range", () => {
  assert.equal(parsePort("5174"), 5174);
  assert.equal(parsePort(""), null);
  assert.equal(parsePort("nope"), null);
  assert.equal(parsePort("0"), null);
});

test("phpPortFromProxyTarget reads loopback http ports only", () => {
  assert.equal(phpPortFromProxyTarget("http://127.0.0.1:9081"), 9081);
  assert.equal(phpPortFromProxyTarget("http://localhost:9080"), 9080);
  assert.equal(phpPortFromProxyTarget("https://wegotworkspace.localhost"), null);
  assert.equal(phpPortFromProxyTarget("not a url"), null);
});

test("nextFreePort skips a bound loopback port", async () => {
  const { server, port } = await listen("127.0.0.1");
  try {
    assert.equal(await isPortFree(port), false);
    const next = await nextFreePort(port);
    assert.notEqual(next, port);
    assert.ok(next > port);
  } finally {
    server.close();
  }
});

test("allocateDevPorts keeps defaults when they are free", async () => {
  // Occupying every default would flake in this repo's own `pnpm dev`. Assert
  // the returned proxy always matches the PHP port we chose.
  const ports = await allocateDevPorts({
    WGW_VITE_DEV_PORT: "5190",
    WGW_VITE_PREVIEW_PORT: "4190",
    WGW_STORYBOOK_PORT: "6090",
    WGW_PHP_DEV_PORT: "9090",
  });
  assert.equal(ports.WGW_PROXY_TARGET, `http://127.0.0.1:${ports.WGW_PHP_DEV_PORT}`);
  assert.match(ports.WGW_VITE_DEV_PORT, /^\d+$/);
});

test("allocateDevPorts shifts off occupied defaults", async () => {
  const held = [];
  try {
    for (const port of [5173, 6006, 9080]) {
      held.push(await listenOn(port));
    }
    const ports = await allocateDevPorts({});
    assert.notEqual(ports.WGW_VITE_DEV_PORT, "5173");
    assert.notEqual(ports.WGW_STORYBOOK_PORT, "6006");
    assert.notEqual(ports.WGW_PHP_DEV_PORT, "9080");
    assert.equal(ports.WGW_PROXY_TARGET, `http://127.0.0.1:${ports.WGW_PHP_DEV_PORT}`);
  } finally {
    await Promise.all(held.map((server) => new Promise((resolve) => server.close(resolve))));
  }
});
