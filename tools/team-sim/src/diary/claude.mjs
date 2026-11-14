import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";

/** A cheaper model for the diary; the alias follows the CLI's latest. */
export const DIARY_MODEL = "haiku";

/**
 * Headless `claude -p` for post-night writing. No tools, no MCP servers, no
 * session saved, a hard dollar cap per call. It runs in a clean environment
 * (HOME, PATH, USER, LANG) so it uses the CLI's own login, the way launchd or
 * a terminal would, and never a host app's session.
 */
export function createClaudeRunner({ bin = "claude", model = DIARY_MODEL, cwd, timeoutMs = 180000 } = {}) {
  const env = { HOME: process.env.HOME, PATH: process.env.PATH, USER: process.env.USER, LANG: "en_US.UTF-8" };

  function available() {
    const r = spawnSync(bin, ["--version"], { env, encoding: "utf8", timeout: 15000 });
    return r.status === 0 ? null : `the \`${bin}\` CLI is not available (${(r.error?.message ?? r.stderr ?? "").trim().slice(0, 120) || `exit ${r.status}`})`;
  }

  /** content: [{ type: "text", text }] or [{ type: "image", path }]. Resolves { text, costUsd, tokens, ms } or rejects. */
  function run({ system, content, budgetUsd }) {
    mkdirSync(cwd, { recursive: true });
    const args = ["-p", "--model", model, "--tools", "", "--strict-mcp-config", "--setting-sources", "project", "--no-session-persistence", "--max-budget-usd", budgetUsd.toFixed(3), "--system-prompt", system, "--input-format", "stream-json", "--output-format", "stream-json", "--verbose"];
    const message = {
      type: "user",
      message: {
        role: "user",
        content: content.map((c) => (c.type === "image" ? { type: "image", source: { type: "base64", media_type: "image/jpeg", data: readFileSync(c.path).toString("base64") } } : c)),
      },
    };
    const started = Date.now();
    return new Promise((resolve, reject) => {
      const child = spawn(bin, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
      let out = "";
      let err = "";
      const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        const result = out.split("\n").filter(Boolean).map(safeJson).filter(Boolean).find((l) => l.type === "result");
        if (!result) return reject(new Error(`claude -p gave no result (exit ${code}): ${(err || out).trim().slice(0, 200)}`));
        const tokens = (result.usage?.input_tokens ?? 0) + (result.usage?.output_tokens ?? 0) + (result.usage?.cache_read_input_tokens ?? 0) + (result.usage?.cache_creation_input_tokens ?? 0);
        if (result.is_error) {
          const e = new Error(`claude -p: ${String(result.result ?? result.terminal_reason ?? "error").slice(0, 200)}`);
          e.fatal = /authenticat|login|OAuth|api key/i.test(String(result.result));
          e.costUsd = result.total_cost_usd ?? 0;
          return reject(e);
        }
        resolve({ text: String(result.result ?? ""), costUsd: result.total_cost_usd ?? 0, tokens, ms: Date.now() - started });
      });
      child.stdin.end(`${JSON.stringify(message)}\n`);
    });
  }

  return { available, run, model };
}

function safeJson(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}
