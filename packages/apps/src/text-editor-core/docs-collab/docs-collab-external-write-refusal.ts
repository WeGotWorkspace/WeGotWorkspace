import { loadCollabText } from "./docs-collab-server-io";
import type { DocsCollabSessionRefs, DocsCollabUrls } from "./docs-collab-types";

/**
 * A save was refused because the text changed outside the app while this
 * document was open (409 `external_write`). Hold every save, load the
 * outside text, and ask the same question a read-time flag asks. The answer
 * saves with that text's entity tag, so a newer outside edit is refused again.
 *
 * Returns false when nobody can be asked (no prompt wired, or the text did
 * not load). The caller then treats the refusal as an ordinary failed save.
 */
export async function askAboutRefusedSave({
  refs,
  urls,
}: {
  refs: DocsCollabSessionRefs;
  urls: DocsCollabUrls;
}): Promise<boolean> {
  if (!urls.onExternalWrite) return false;
  refs.externalWriteHoldRef.current = true;
  try {
    const text = await loadCollabText(urls.documentUrl, refs.authTokenRef.current);
    refs.externalWriteSeenRef.current = text.etag ?? null;
    urls.onExternalWrite({ markdown: text.markdown, title: text.title });
    return true;
  } catch {
    refs.externalWriteHoldRef.current = false;
    return false;
  }
}
