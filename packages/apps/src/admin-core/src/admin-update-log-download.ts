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

/**
 * Opens an empty window. Call it straight from the click, before any await, so browsers
 * treat it as user-initiated. Null when the browser blocked it.
 */
export function openBlankWindow(): Window | null {
  // `noopener` would make window.open return null even on success; cut the opener by hand.
  const opened = window.open("about:blank", "_blank");
  if (opened) opened.opener = null;
  return opened;
}

/** Shows the lines as plain text in a window from `openBlankWindow`. */
export function showPlainTextLinesInWindow(target: Window, lines: readonly string[]): void {
  const blob = new Blob([`${lines.join("\n")}\n`], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  target.location.href = url;
  // The window has read the blob by then; free it a little later.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
