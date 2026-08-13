<?php

declare(strict_types=1);

namespace App\Services\Jmap\Blobs;

/**
 * A domain's claim on envelope blobs: the garbage collector never deletes a
 * blob some domain still references, however long expired (hard requirement
 * of draft-ietf-jmap-filenode-14 — a blob referenced by a live FileNode MUST
 * NOT be expired or collected; mail drafts will need the same).
 *
 * Contacts deliberately registers no checker: card media is copied into the
 * vCard as a data: URI on write, so cards never hold live blob references.
 */
interface JmapBlobReferenceCheckerInterface
{
    public function isReferenced(string $username, string $blobId): bool;
}
