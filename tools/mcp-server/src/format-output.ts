export const OUTPUT_CAP_BYTES = 512 * 1024;
export const DEFAULT_TAIL_LINES = 200;

export function capOutput(output: string): string {
  if (Buffer.byteLength(output, "utf8") <= OUTPUT_CAP_BYTES) {
    return output;
  }

  let trimmed = output;
  while (Buffer.byteLength(trimmed, "utf8") > OUTPUT_CAP_BYTES) {
    const nextNewline = trimmed.indexOf("\n");
    if (nextNewline === -1) {
      const excess = Buffer.byteLength(trimmed, "utf8") - OUTPUT_CAP_BYTES;
      return trimmed.slice(excess);
    }
    trimmed = trimmed.slice(nextNewline + 1);
  }

  return trimmed;
}

export function tailOutput(fullOutput: string, tailLines: number): string {
  if (tailLines <= 0) {
    return "";
  }

  const lines = fullOutput.split("\n");
  if (lines.length <= tailLines) {
    return fullOutput;
  }

  const tail = lines.slice(-tailLines).join("\n");
  return `[…truncated, showing last ${tailLines} lines…]\n${tail}`;
}
