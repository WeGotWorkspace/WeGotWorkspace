<?php

declare(strict_types=1);

namespace App\Services\Collab;

use App\Services\Drive\DriveShareAuthorizer;
use App\Services\Notes\NoteMarkdownCodec;
use App\Services\Search\BestEffortSearchIndexSync;
use App\Services\Search\SearchIndexerService;
use App\Storage\StoragePaths;
use App\Storage\WgwStorage;
use App\Support\WgwSettings;
use Illuminate\Http\Request;

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
        private NoteMarkdownCodec $noteCodec,
        private SearchIndexerService $search,
        private BestEffortSearchIndexSync $searchSync,
    ) {}

    public function getMarkdown(Request $request, mixed $room): string
    {
        $virtual = $this->resolveReadablePath($request, $room);
        $key = $this->paths->virtualToStorageKey($virtual);
        $disk = $this->storage->files();
        $isNote = $this->paths->isNotePath($virtual);
        if (! $disk->fileExists($key)) {
            // A note body that has never been written starts empty; the
            // frontmatter is owned by the Notes metadata API, not collab.
            return $isNote ? '' : self::DEFAULT_MARKDOWN;
        }

        $contents = $disk->get($key);
        if (! is_string($contents)) {
            return $isNote ? '' : self::DEFAULT_MARKDOWN;
        }

        // For notes the collab document is the body section only; frontmatter
        // never enters the shared (Yjs) document so metadata stays Notes-owned.
        if ($isNote) {
            return $this->noteCodec->bodyOf($contents);
        }

        return $contents === '' ? self::DEFAULT_MARKDOWN : $contents;
    }

    /**
     * @return non-empty-string|null null when sidecar is missing or empty
     */
    public function getYjsBinary(Request $request, mixed $room): ?string
    {
        $virtual = $this->resolveReadablePath($request, $room);
        $key = $this->paths->virtualToStorageKey($this->yjsSidecarPath($virtual));
        $disk = $this->storage->files();
        if (! $disk->fileExists($key)) {
            return null;
        }

        $size = (int) ($disk->size($key) ?? 0);
        if ($size <= 0) {
            return null;
        }

        $contents = $disk->get($key);
        if (! is_string($contents) || $contents === '') {
            return null;
        }

        return $contents;
    }

    /**
     * @param  array<string, mixed>  $body
     * @return array{ok: true}
     */
    public function put(Request $request, array $body): array
    {
        $virtual = $this->resolveWritablePath($request, $body['room'] ?? null);
        $hasMarkdown = array_key_exists('markdown', $body);
        $hasYjs = array_key_exists('yjs', $body);
        if (! $hasMarkdown && ! $hasYjs) {
            $this->fail('nothing_to_save');
        }

        $disk = $this->storage->files();
        if ($hasMarkdown) {
            if (! is_string($body['markdown'])) {
                $this->fail('invalid_markdown');
            }
            $markdown = $body['markdown'];
            if (strlen($markdown) > self::MAX_MARKDOWN_BYTES) {
                $this->fail('markdown_too_large', 413);
            }
            $documentKey = $this->paths->virtualToStorageKey($virtual);
            if ($this->paths->isNotePath($virtual)) {
                // The collab payload is the note body only: merge it back into
                // the existing frontmatter so a body save never clobbers title
                // or tags. The frontmatter `updated` marker is preserved so a
                // body save does not advance metadata state. For legacy notes
                // without a marker we freeze it at the pre-write mtime so the
                // first body save still leaves the marker stable.
                $existing = $disk->fileExists($documentKey) ? (string) $disk->get($documentKey) : '';
                $preservedUpdated = $this->noteCodec->updatedOf($existing);
                if ($preservedUpdated === null && $disk->fileExists($documentKey)) {
                    $preservedUpdated = date('c', (int) $disk->lastModified($documentKey));
                }
                $markdown = $this->noteCodec->replaceBody(
                    $existing,
                    $markdown,
                    basename($virtual, '.md'),
                    $preservedUpdated,
                );
            }
            $disk->put($documentKey, $markdown);
            // Keep the unified search index in sync with the written content so size and
            // body reflect the latest save without waiting for a later rename/upload.
            $this->searchSync->sync(
                'collab',
                fn () => $this->search->indexFileStorageKey($documentKey),
                'files/'.$documentKey,
            );
        }

        if ($hasYjs) {
            $bytes = $this->decodeYjsBytes($body['yjs']);
            if (strlen($bytes) > self::MAX_YJS_BYTES) {
                $this->fail('yjs_too_large', 413);
            }
            $disk->put($this->paths->virtualToStorageKey($this->yjsSidecarPath($virtual)), $bytes);
        }

        return ['ok' => true];
    }

    private function yjsSidecarPath(string $documentVirtualPath): string
    {
        $normalized = $this->paths->normalizeVirtualPath($documentVirtualPath);
        $dir = (string) dirname($normalized);
        $name = (string) basename($normalized);
        $hidden = '.'.$name.'.yjs';
        $prefix = $dir === '/' ? '' : $dir;

        return $this->paths->normalizeVirtualPath($prefix.'/'.$hidden);
    }

    private function resolveReadablePath(Request $request, mixed $room): string
    {
        $this->assertFilesEnabled();
        $principal = $this->actors->requirePrincipal($request);
        $virtual = $this->paths->normalizeVirtualPath($this->rooms->cleanDocumentPath($room));
        try {
            $this->authorizer->assertMayRead($virtual, $principal);
            $rights = $this->authorizer->effectiveRights($virtual, $principal);
        } catch (\InvalidArgumentException) {
            $this->fail('forbidden', 403);
        }
        // Public share guests stay on the non-collab Docs shell; collab mesh is members-only.
        if (($principal['role'] ?? '') === 'guest') {
            $this->fail('forbidden', 403);
        }
        // View-only member grants may load the document/Yjs snapshot read-only; writes stay gated
        // by resolveWritablePath (mayEditContent). Comment mutations are UI-enforced and still
        // cannot persist via PUT without edit rights (or a future comment-save path).
        if (! $rights['mayView']) {
            $this->fail('forbidden', 403);
        }

        return $virtual;
    }

    private function resolveWritablePath(Request $request, mixed $room): string
    {
        $this->assertFilesEnabled();
        $principal = $this->actors->requirePrincipal($request);
        $virtual = $this->paths->normalizeVirtualPath($this->rooms->cleanDocumentPath($room));
        try {
            $rights = $this->authorizer->effectiveRights($virtual, $principal);
        } catch (\InvalidArgumentException) {
            $this->fail('forbidden', 403);
        }
        if (! $rights['mayEditContent']) {
            $this->fail('forbidden', 403);
        }

        return $virtual;
    }

    /**
     * @param  list<mixed>|mixed  $yjs
     */
    private function decodeYjsBytes(mixed $yjs): string
    {
        if (! is_array($yjs)) {
            $this->fail('invalid_yjs');
        }

        $bytes = '';
        foreach ($yjs as $byte) {
            if (! is_int($byte) || $byte < 0 || $byte > 255) {
                $this->fail('invalid_yjs');
            }
            $bytes .= chr($byte);
        }

        return $bytes;
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
