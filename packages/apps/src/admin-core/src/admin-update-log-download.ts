export function downloadPlainTextLines(filename: string, lines: readonly string[]): void {
  const blob = new Blob([`${lines.join("\n")}\n`], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Shows the lines as plain text in a new browser window. False when the window was blocked. */
export function openPlainTextLinesInNewWindow(lines: readonly string[]): boolean {
  const blob = new Blob([`${lines.join("\n")}\n`], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const opened = window.open(url, "_blank", "noopener");
  // The new window has read the blob by then; free it a little later.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return opened !== null;
}
