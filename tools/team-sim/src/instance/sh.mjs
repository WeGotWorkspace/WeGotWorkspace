import { spawn, spawnSync } from "node:child_process";

/**
 * Command runner. Every step logs one line; output goes to the night log
 * when `log` is given. Tests replace it with a recorder.
 */
export function createShell({ log = () => {}, dryRun = false } = {}) {
  const calls = [];
  function run(cmd, args, opts = {}) {
    const line = [cmd, ...args].join(" ");
    calls.push({ cmd, args, cwd: opts.cwd });
    log(`$ ${line}${opts.cwd ? `   (in ${opts.cwd})` : ""}`);
    if (dryRun && !opts.readOnly) return { status: 0, stdout: "", stderr: "" };
    const res = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...opts, env: { ...process.env, ...opts.env } });
    if (res.error) throw res.error;
    if (res.status !== 0 && !opts.allowFail) {
      const tail = `${res.stdout ?? ""}\n${res.stderr ?? ""}`.trim().split("\n").slice(-25).join("\n");
      throw new Error(`command failed (${res.status}): ${line}\n${tail}`);
    }
    return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
  }
  /** Long-running command with output streamed into the log (builds). */
  function stream(cmd, args, opts = {}) {
    const line = [cmd, ...args].join(" ");
    calls.push({ cmd, args, cwd: opts.cwd });
    log(`$ ${line}${opts.cwd ? `   (in ${opts.cwd})` : ""}`);
    if (dryRun) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, { ...opts, env: { ...process.env, ...opts.env }, stdio: ["ignore", "pipe", "pipe"] });
      let tail = "";
      const onData = (d) => {
        const s = d.toString();
        tail = (tail + s).slice(-6000);
        opts.onOutput?.(s);
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      child.on("error", reject);
      child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`command failed (${code}): ${line}\n${tail.split("\n").slice(-25).join("\n")}`))));
    });
  }
  return { run, stream, calls, dryRun };
}
