<?php

declare(strict_types=1);

namespace App\Dav\Server;

use App\Services\Collab\DocYjsStateStore;
use App\Storage\StoragePaths;
use Sabre\DAV\Server;
use Sabre\DAV\ServerPlugin;

/**
 * #1349: a DAV write to a collab document is allowed and detected on the
 * next yjs read. A document saved before that link existed gets its row
 * here, from the markdown as it is before the write.
 *
 * Sabre emits these events after ACL, the If-Match / If-None-Match
 * preconditions, and lock tokens, right before the bytes are written. A
 * refused write never reads the document or writes a row.
 */
final class DocYjsStateDavPlugin extends ServerPlugin
{
    public function __construct(
        private readonly DocYjsStateStore $sidecarLinks,
        private readonly StoragePaths $paths,
    ) {}

    public function initialize(Server $server): void
    {
        $server->on('beforeWriteContent', [$this, 'beforeWrite'], 200);
        $server->on('beforeCreateFile', [$this, 'beforeWrite'], 200);
    }

    public function beforeWrite(string $path): void
    {
        $path = trim($path, '/');
        if (! str_starts_with($path, 'files/')) {
            return;
        }
        $key = substr($path, strlen('files/'));
        if ($key === '') {
            return;
        }

        $this->sidecarLinks->recordBeforeExternalWrite($this->paths->virtualToStorageKey('/'.$key));
    }
}
