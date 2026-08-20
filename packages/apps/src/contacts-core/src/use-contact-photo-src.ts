import { useEffect, useMemo, useState } from "react";

import { downloadContactBlob } from "@/lib/api/wgw/contacts";

import { contactPhotoBlobId, contactPhotoUrl } from "./contacts-display-utils";
import type { ContactCard } from "./contacts-types";

function isDirectPhotoUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:");
}

/**
 * Resolves a contact photo for `<img src>`. Public http(s)/data URLs pass through;
 * API blob references are fetched with the session bearer token and exposed as blob: URLs.
 */
export function useContactPhotoSrc(card: ContactCard | undefined): string | undefined {
  const directUrl = useMemo(() => {
    if (!card) return undefined;
    const url = contactPhotoUrl(card);
    if (!url || !isDirectPhotoUrl(url)) return undefined;
    return url;
  }, [card]);

  const blobId = useMemo(() => (card ? contactPhotoBlobId(card) : undefined), [card]);
  const [blobSrc, setBlobSrc] = useState<string | undefined>();

  useEffect(() => {
    if (!blobId) {
      setBlobSrc(undefined);
      return;
    }

    let cancelled = false;
    let objectUrl: string | undefined;

    void (async () => {
      try {
        const res = await downloadContactBlob(blobId);
        if (!res.ok || cancelled) return;
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setBlobSrc(objectUrl);
      } catch {
        if (!cancelled) setBlobSrc(undefined);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [blobId]);

  return directUrl ?? blobSrc;
}
