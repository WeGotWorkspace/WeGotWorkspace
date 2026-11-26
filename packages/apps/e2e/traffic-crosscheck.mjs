#!/usr/bin/env node
// Cross-check a traffic report against the API server's own log.
//
//   node e2e/traffic-crosscheck.mjs <report.json> <php-server.log>
//
// The PHP built-in server prints one "Accepted" line per connection (one per
// request, it does not keep connections alive), with the time to the second.
// This counts those lines inside the report's window, per minute, and prints
// them next to the browser-side counts. Browser and server agree when the two
// per-minute rows differ by a few requests (second rounding at the window
// edges, the harness's own seed calls if they fall inside the window). A
// browser that counts clearly more than the server saw requests that never
// reached it (blocked, cached, or counted twice); clearly fewer means requests
// the meter missed. Only use it with a log of one API that nothing else talks
// to during the run.
import fs from "node:fs";

const [reportPath, logPath] = process.argv.slice(2);
if (!reportPath || !logPath) {
  console.error("usage: traffic-crosscheck.mjs <report.json> <php-server.log>");
  process.exit(2);
}

const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const MONTHS = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};
// [Wed Nov 25 17:14:55 2026] 127.0.0.1:58647 Accepted
const line = /^\[\w{3} (\w{3}) +(\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})\] \S+ Accepted$/;

const minutes = report.perMinute.length;
const server = Array.from({ length: minutes }, () => 0);
let total = 0;
for (const text of fs.readFileSync(logPath, "utf8").split("\n")) {
  const m = line.exec(text);
  if (!m) continue;
  const at = new Date(+m[6], MONTHS[m[1]], +m[2], +m[3], +m[4], +m[5]).getTime();
  // The log has whole seconds: widen the window by one second at the start.
  if (at < report.startedAt - 1000 || at > report.endedAt) continue;
  const minute = Math.min(minutes - 1, Math.max(0, Math.floor((at - report.startedAt) / 60_000)));
  server[minute] += 1;
  total += 1;
}

console.log(
  `${report.scenario}: window ${((report.endedAt - report.startedAt) / 1000).toFixed(0)} s`,
);
console.log(`  browser per minute: ${report.perMinute.join(" / ")} (total ${report.total})`);
console.log(`  server  per minute: ${server.join(" / ")} (total ${total})`);
console.log(`  difference (browser - server): ${report.total - total}`);
