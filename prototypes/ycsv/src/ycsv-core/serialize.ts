import YAML from "yaml";
import { serializeCsv } from "./csv";
import type { YcsvFile } from "./types";

const PREFERRED_KEYS = [
  "ycsv_version",
  "name",
  "description",
  "created",
  "author",
  "columns",
  "defs",
  "cells",
  "charts",
];

export function serialize(file: YcsvFile): string {
  const ordered: Record<string, unknown> = {};
  for (const key of PREFERRED_KEYS) {
    if (key in file.frontmatter) ordered[key] = file.frontmatter[key];
  }
  for (const key of Object.keys(file.frontmatter)) {
    if (!(key in ordered)) ordered[key] = file.frontmatter[key];
  }

  const yamlText = YAML.stringify(ordered, {
    indent: 2,
    lineWidth: 0,
    singleQuote: false,
    nullStr: "",
  });
  const csvText = serializeCsv([file.header, ...file.rows]);
  return `---\n${yamlText}---\n${csvText}`;
}
