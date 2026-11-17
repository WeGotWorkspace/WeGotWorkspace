import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { missedNights } from "../report/report.mjs";

const STALE_MS = 2 * 86400000;
/** A scheduled night that starts at or after this local hour is skipped as missed. */
export const LATEST_START_HOUR = 6;

const readJson = (file, fallback) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : fallback);

/** `sim status`: the last completed night; not ok after two days without one. */
export function status({ paths, now = new Date() }) {
  const last = readJson(paths.lastNight, null);
  const nights = readJson(paths.nightsLog, []);
  const today = now.toLocaleDateString("sv-SE");
  if (!last) return { ok: false, text: "No night has completed yet." };
  const age = now.getTime() - Date.parse(last.endedAt);
  const ok = age <= STALE_MS;
  const missed = missedNights(nights, today);
  const lines = [
    `Last night: ${last.date}, ended ${new Date(last.endedAt).toLocaleString("nl-NL")} (commit ${last.sha?.slice(0, 10) ?? "?"}).`,
    `Report: ${last.report}`,
  ];
  if (missed.length) lines.push(`Missed: ${missed.join(", ")}`);
  if (!ok) lines.push(`No night completed in the last 2 days.`);
  return { ok, text: lines.join("\n") };
}

/** True when a scheduled run woke too late (the Mac slept through the slot): skip, never act during the day. */
export function startedTooLate(now = new Date()) {
  const h = now.getHours();
  return h >= LATEST_START_HOUR && h < 22;
}

export function recordMissed(paths, date, reason) {
  const nights = readJson(paths.nightsLog, []).filter((n) => n.date !== date);
  writeFileSync(paths.nightsLog, `${JSON.stringify([...nights, { date, status: "missed", reason, at: new Date().toISOString() }], null, 1)}\n`);
}
