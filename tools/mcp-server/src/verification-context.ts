import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { findRepoRoot } from "./repo-root.js";

const CONTEXT_FILES = [
  ".agents/POLICY.md",
  ".agents/skills/clean-code/smells.md",
  ".agents/skills/developer/done-checklist.md",
] as const;

export async function getVerificationContext(): Promise<string> {
  const root = await findRepoRoot();
  const sections: string[] = [];

  for (const relativePath of CONTEXT_FILES) {
    const absolutePath = join(root, relativePath);
    const content = await readFile(absolutePath, "utf8");
    sections.push(`# ${relativePath}\n\n${content}`);
  }

  return sections.join("\n\n---\n\n");
}
