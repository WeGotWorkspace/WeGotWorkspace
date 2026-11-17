import { readFileSync } from "node:fs";

const load = (name) => JSON.parse(readFileSync(new URL(`./${name}.json`, import.meta.url), "utf8"));

/** Committed content pools. Nothing is generated at run time. */
export const corpus = Object.freeze({
  chat: load("chat"),
  tasks: load("tasks"),
  docs: load("docs"),
  notes: load("notes"),
  files: load("files"),
  gaps: load("gaps"),
});
