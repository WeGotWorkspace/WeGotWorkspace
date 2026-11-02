<?php

declare(strict_types=1);

namespace App\Services\Collab;

use App\Events\EventDispatch;
use App\Services\Drive\DriveShareAuthorizer;
use App\Services\Jmap\FileNodes\FileNodeIndexService;
use App\Storage\StoragePaths;
use App\Storage\WgwStorage;
use App\Support\ExclusiveFileLock;
use App\Support\WgwSettings;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

/**
 * Text document + Yjs sidecar persistence on the drive files disk.
 *
 * Sidecar convention: /.{filename}.yjs next to the document (any allowed text extension).
 * Request/response body field is named `markdown` but holds UTF-8 bytes for all text formats.
 */
final class DocCollabDocumentService
{
    private const DEFAULT_MARKDOWN = '';

    private const MAX_MARKDOWN_BYTES = 2_097_152;

    private const MAX_YJS_BYTES = 5_242_880;

    public function __construct(
        private CollabActorResolver $actors,
        private CollabRoomPolicy $rooms,
        private WgwStorage $storage,
        private StoragePaths $paths,
        private DriveShareAuthorizer $authorizer,
        private FileNodeIndexService $fileNodes,
        private DocYjsStateStore $states,
        private EventDispatch $eventDispatch = new EventDispatch([]),
    ) {}

    public function getMarkdown(Request $request, mixed $room): string
    {
        $virtual = $this->resolveReadablePath($request, $room);
        $key = $this->paths->virtualToStorageKey($virtual);
        $disk = $this->storage->files();
        if (! $disk->fileExists($key)) {
            return self::DEFAULT_MARKDOWN;
        }

        $contents = $disk->get($key);
        if (! is_string($contents) || $contents === '') {
            return self::DEFAULT_MARKDOWN;
        }

        return $contents;
    }

    /**
     * `externalWrite` is set when the markdown on disk is not the text this
     * sidecar was saved with (#1349).
     *
     * @return array{bytes: non-empty-string, externalWrite: bool}|null null when sidecar is missing or empty
     */
    public function getYjsSnapshot(Request $request, mixed $room): ?array
    {
        $virtual = $this->resolveReadablePath($request, $room);
        $key = $this->paths->virtualToStorageKey($this->yjsSidecarPath($virtual));
        $disk = $this->storage->files();
        if (! $disk->fileExists($key)) {
            return null;
        }

        $size = (int) ($disk->size($key));
        if ($size <= 0) {
            return null;
        }

        $contents = $disk->get($key);
        if (! is_string($contents) || $contents === '') {
            return null;
        }

        return [
            'bytes' => $contents,
            'externalWrite' => $this->states->isExternalWrite($this->paths->virtualToStorageKey($virtual), $contents),
        ];
    }

    /**
     * Contract C7: the sidecar entity tag is the sha1 of the stored bytes.
     */
    public static function sidecarEtag(string $sidecarBytes): string
    {
        return '"'.sha1($sidecarBytes).'"';
    }

    /**
     * @param  array<string, mixed>  $body
     * @return array{ok: true, etag: string|null}
     */
    public function put(Request $request, array $body): array
    {
        $virtual = $this->resolveWritablePath($request, $body['room'] ?? null);
        $hasMarkdown = array_key_exists('markdown', $body);
        $hasYjs = array_key_exists('yjs', $body);
        if (! $hasMarkdown && ! $hasYjs) {
            $this->fail('nothing_to_save');
        }

        $markdown = null;
        if ($hasMarkdown) {
            if (! is_string($body['markdown'])) {
                $this->fail('invalid_markdown');
            }
            $markdown = $body['markdown'];
            if (strlen($markdown) > self::MAX_MARKDOWN_BYTES) {
                $this->fail('markdown_too_large', 413);
            }
        }

        $yjsBytes = null;
        if ($hasYjs) {
            if (! is_string($body['yjs'])) {
                $this->fail('invalid_yjs');
            }
            $yjsBytes = $body['yjs'];
            if (strlen($yjsBytes) > self::MAX_YJS_BYTES) {
                $this->fail('yjs_too_large', 413);
            }
        }

        $disk = $this->storage->files();
        $sidecarKey = $this->paths->virtualToStorageKey($this->yjsSidecarPath($virtual));
        $documentKey = $this->paths->virtualToStorageKey($virtual);
        $username = $markdown !== null ? $this->actors->requirePrincipal($request)['username'] : null;
        // Check and write share one flock so two first opens cannot both pass
        // `If-None-Match: *`. The sidecar lands first; a failed markdown write
        // puts the previous sidecar back.
        $lock = $this->acquireDocumentLock($sidecarKey);
        try {
            $this->assertSidecarPrecondition($request, $sidecarKey, $yjsBytes !== null);
            $previousSidecar = $this->readSidecarBytes($sidecarKey);
            $this->assertNoUnseenExternalWrite($request, $documentKey, $previousSidecar);
            $wroteSidecar = false;
            if ($yjsBytes !== null) {
                $disk->put($sidecarKey, $yjsBytes);
                $wroteSidecar = true;
            }
            if ($markdown !== null) {
                try {
                    $disk->put($documentKey, $markdown);
                } catch (\Throwable $e) {
                    if ($wroteSidecar) {
                        $this->restoreSidecar($sidecarKey, $previousSidecar);
                    }
                    throw $e;
                }
                $this->recordSidecarLink($documentKey, $markdown, $yjsBytes);
                try {
                    $this->fileNodes->recordContentWrite($documentKey, hash('sha256', $markdown));
                } catch (\Throwable $e) {
                    Log::warning('file_node_index_sync_failed', ['error' => $e->getMessage(), 'key' => $documentKey]);
                }
                $this->eventDispatch->fireMutation(
                    (string) $username,
                    'collab',
                    'written',
                    'files/'.$documentKey,
                );
            } elseif ($yjsBytes !== null) {
                $this->recordSidecarLink($documentKey, null, $yjsBytes);
            }
        } finally {
            $this->releaseDocumentLock($lock);
        }

        return ['ok' => true, 'etag' => $this->storedSidecarEtag($sidecarKey)];
    }

    /**
     * #1349: which markdown the sidecar now belongs to. Only a save that
     * writes the sidecar links it: a markdown-only save leaves the old row,
     * so the next read still flags the new text. The bytes are already on
     * disk, so a failed row write logs and does not fail the save.
     */
    private function recordSidecarLink(string $documentKey, ?string $markdown, ?string $sidecar): void
    {
        if ($sidecar === null) {
            return;
        }
        try {
            if ($markdown === null) {
                $this->states->recordSidecar($documentKey, $sidecar);
            } else {
                $this->states->record($documentKey, $markdown, $sidecar);
            }
        } catch (\Throwable $e) {
            Log::warning('doc_yjs_state_sync_failed', ['error' => $e->getMessage(), 'key' => $documentKey]);
        }
    }

    /**
     * Shared-hosting lock under the framework lock directory, not beside the
     * user's document. The path is the sha1 of the sidecar key.
     *
     * @return resource
     */
    private function acquireDocumentLock(string $sidecarKey)
    {
        try {
            return ExclusiveFileLock::acquire(self::documentLockPath($sidecarKey));
        } catch (\RuntimeException) {
            $this->fail('lock_unavailable', 503);
        }
    }

    public static function documentLockPath(string $sidecarKey): string
    {
        return storage_path('framework/locks/'.sha1($sidecarKey));
    }

    /**
     * @param  resource  $handle
     */
    private function releaseDocumentLock($handle): void
    {
        ExclusiveFileLock::release($handle);
    }

    private function readSidecarBytes(string $sidecarKey): ?string
    {
        $disk = $this->storage->files();
        if (! $disk->fileExists($sidecarKey)) {
            return null;
        }

        $contents = $disk->get($sidecarKey);

        return is_string($contents) && $contents !== '' ? $contents : null;
    }

    private function restoreSidecar(string $sidecarKey, ?string $previous): void
    {
        $disk = $this->storage->files();
        if ($previous === null) {
            if ($disk->fileExists($sidecarKey)) {
                $disk->delete($sidecarKey);
            }

            return;
        }

        $disk->put($sidecarKey, $previous);
    }

    /**
     * #1349: a client that holds the current sidecar tag would still write
     * over an outside edit it never saw. While the stored markdown is not
     * the text this sidecar was saved with, a save must name the text it saw
     * in `X-Wgw-External-Write` (that representation's entity tag). A newer
     * outside edit makes that tag stale, so it is refused again.
     */
    private function assertNoUnseenExternalWrite(
        Request $request,
        string $documentKey,
        ?string $sidecar,
    ): void {
        if ($sidecar === null || ! $this->states->isExternalWrite($documentKey, $sidecar)) {
            return;
        }

        $seen = (string) $request->headers->get(CollabExternalWrite::HEADER, '');
        if ($this->namesText($seen, $this->states->storedTextEtag($documentKey))) {
            return;
        }

        $this->fail('external_write', 409);
    }

    /**
     * The acknowledgement must name the text exactly. Unlike `If-Match`, a
     * `*` would acknowledge any outside text unseen, so it never matches.
     */
    private function namesText(string $header, string $stored): bool
    {
        foreach (explode(',', $header) as $candidate) {
            $candidate = trim($candidate);
            if (str_starts_with($candidate, 'W/')) {
                $candidate = substr($candidate, 2);
            }
            if ($candidate !== '' && $candidate !== '*' && hash_equals($stored, $candidate)) {
                return true;
            }
        }

        return false;
    }

    /**
     * C7: `If-Match` must name the stored sidecar, `If-None-Match: *` requires
     * there to be none. A yjs write over an existing sidecar must carry one of
     * the two; without it the save would blind-overwrite concurrent work.
     */
    private function assertSidecarPrecondition(
        Request $request,
        string $sidecarKey,
        bool $writesSidecar,
    ): void {
        $ifMatch = trim((string) $request->headers->get('If-Match', ''));
        $ifNoneMatch = trim((string) $request->headers->get('If-None-Match', ''));

        if ($ifMatch === '' && $ifNoneMatch === '') {
            if ($writesSidecar && $this->storedSidecarEtag($sidecarKey) !== null) {
                $this->fail('precondition_required', 428);
            }

            return;
        }

        $stored = $this->storedSidecarEtag($sidecarKey);
        if ($ifNoneMatch === '*' && $stored !== null) {
            $this->fail('precondition_failed', 412);
        }
        if ($ifMatch !== '' && ! $this->etagSatisfies($ifMatch, $stored)) {
            $this->fail('precondition_failed', 412);
        }
    }

    private function storedSidecarEtag(string $sidecarKey): ?string
    {
        $disk = $this->storage->files();
        if (! $disk->fileExists($sidecarKey)) {
            return null;
        }

        $contents = $disk->get($sidecarKey);
        if (! is_string($contents) || $contents === '') {
            return null;
        }

        return self::sidecarEtag($contents);
    }

    private function etagSatisfies(string $header, ?string $stored): bool
    {
        if ($stored === null) {
            return false;
        }
        if ($header === '*') {
            return true;
        }

        foreach (explode(',', $header) as $candidate) {
            $candidate = trim($candidate);
            if (str_starts_with($candidate, 'W/')) {
                $candidate = substr($candidate, 2);
            }
            if ($candidate !== '' && $candidate === $stored) {
                return true;
            }
        }

        return false;
    }

    private function yjsSidecarPath(string $documentVirtualPath): string
    {
        return CollabSidecarPaths::sidecarVirtualPath($this->paths, $documentVirtualPath);
    }

    /** Signed-in readers only. A path the caller may not read is not found. */
    private function resolveReadablePath(Request $request, mixed $room): string
    {
        return $this->readableDocument($request, $room)['path'];
    }

    /** As {@see resolveReadablePath()}, and a reader without edit rights is forbidden. */
    private function resolveWritablePath(Request $request, mixed $room): string
    {
        $document = $this->readableDocument($request, $room);
        // View-only member grants may load the document/Yjs snapshot read-only. Comment and
        // suggestion discussion persists via REST `/files/threads` (mayComment), not this PUT.
        if (! $document['mayEditContent']) {
            $this->fail('forbidden', 403);
        }

        return $document['path'];
    }

    /**
     * @return array{path: string, mayEditContent: bool}
     */
    private function readableDocument(Request $request, mixed $room): array
    {
        $this->assertFilesEnabled();
        $principal = $this->actors->requirePrincipal($request);
        // Public share guests stay on the non-collab Docs shell; collab mesh is members-only.
        if ($principal['role'] === 'guest') {
            $this->fail('forbidden', 403);
        }
        // A `..` segment never resolves to another path: it is not found, like any path outside reach.
        if (is_string($room) && $this->paths->hasParentSegment($room)) {
            $this->fail('not_found', 404);
        }
        $virtual = $this->paths->normalizeVirtualPath($this->rooms->cleanDocumentPath($room));
        try {
            $rights = $this->authorizer->effectiveRights($virtual, $principal);
        } catch (\InvalidArgumentException) {
            $this->fail('not_found', 404);
        }
        if (! $rights['mayView']) {
            $this->fail('not_found', 404);
        }

        return ['path' => $virtual, 'mayEditContent' => $rights['mayEditContent']];
    }

    private function assertFilesEnabled(): void
    {
        $cfg = WgwSettings::normalized();
        if (! (bool) ($cfg[WgwSettings::FILES_ENABLED] ?? true)) {
            $this->fail('files_disabled', 503, 'WebDAV files are disabled for this site.');
        }
    }

    private function fail(string $error, int $status = 400, ?string $message = null): never
    {
        $payload = ['error' => $error];
        if ($message !== null) {
            $payload['message'] = $message;
        }
        throw new CollabResponseException($status, $payload);
    }
}
