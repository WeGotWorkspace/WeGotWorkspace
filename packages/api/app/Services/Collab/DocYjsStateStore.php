<?php

declare(strict_types=1);

namespace App\Services\Collab;

use App\Models\DocYjsState;
use App\Storage\WgwStorage;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\Log;

/**
 * Which markdown a Docs Yjs sidecar was saved with (#1349).
 *
 * The collab save writes the row. A later read hashes the markdown on disk
 * and compares: a different hash means something outside the collab path
 * rewrote the text, so the sidecar is no longer an ancestor of it. The
 * index hash on `jmap_file_nodes` is not used, because a DAV write clears it.
 *
 * Keys are document storage keys, never sidecar keys.
 */
final class DocYjsStateStore
{
    public function __construct(
        private readonly WgwStorage $storage,
    ) {}

    public static function contentEtag(string $markdown): string
    {
        return hash('sha256', $markdown);
    }

    /** After a collab save wrote the markdown. The sidecar is what is on disk now. */
    public function record(string $documentKey, string $markdown, string $sidecarBytes): void
    {
        DocYjsState::query()->updateOrCreate(
            ['storage_key_hash' => self::keyHash($documentKey)],
            [
                'storage_key' => $documentKey,
                'content_etag' => self::contentEtag($markdown),
                'sidecar_etag' => sha1($sidecarBytes),
            ],
        );
    }

    /** A yjs-only save. Without a row there is no markdown to link it to. */
    public function recordSidecar(string $documentKey, string $sidecarBytes): void
    {
        DocYjsState::query()
            ->where('storage_key_hash', self::keyHash($documentKey))
            ->update(['sidecar_etag' => sha1($sidecarBytes)]);
    }

    /**
     * Before a write outside the collab path replaces a document that has a
     * sidecar and no row yet. The markdown on disk now is what the sidecar
     * was saved with: until #1349 that write path was blocked.
     */
    public function recordBeforeExternalWrite(string $documentKey, string $sidecarKey): void
    {
        $disk = $this->storage->files();
        if (! $disk->fileExists($sidecarKey) || $this->find($documentKey) !== null) {
            return;
        }

        $markdown = $disk->fileExists($documentKey) ? $disk->get($documentKey) : '';
        $sidecar = $disk->get($sidecarKey);
        DocYjsState::query()->insertOrIgnore([
            'storage_key' => $documentKey,
            'storage_key_hash' => self::keyHash($documentKey),
            'content_etag' => self::contentEtag(is_string($markdown) ? $markdown : ''),
            'sidecar_etag' => sha1(is_string($sidecar) ? $sidecar : ''),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /**
     * No row is a normal state: nothing is known, so nothing is flagged. A
     * row written for another sidecar says nothing about this one either:
     * a save between its sidecar write and its row write, or a failed row
     * write. Only a matching sidecar makes the markdown hash meaningful.
     */
    public function isExternalWrite(string $documentKey, string $sidecarBytes): bool
    {
        $row = $this->find($documentKey);
        if ($row === null || ! hash_equals($row->sidecar_etag, sha1($sidecarBytes))) {
            return false;
        }

        $disk = $this->storage->files();
        $markdown = $disk->fileExists($documentKey) ? $disk->get($documentKey) : '';

        return ! hash_equals($row->content_etag, self::contentEtag(is_string($markdown) ? $markdown : ''));
    }

    /** Best-effort, like the sidecar it follows. */
    public function moveWithDocument(string $fromKey, string $toKey): void
    {
        try {
            $this->move($fromKey, $toKey);
        } catch (\Throwable $e) {
            Log::warning('doc_yjs_state_sync_failed', [
                'op' => 'move',
                'from' => $fromKey,
                'to' => $toKey,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /** Best-effort, like the sidecar it follows. */
    public function deleteWithDocument(string $key): void
    {
        try {
            $this->delete($key);
        } catch (\Throwable $e) {
            Log::warning('doc_yjs_state_sync_failed', [
                'op' => 'delete',
                'key' => $key,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /** The document, or every document under a moved folder. */
    private function move(string $fromKey, string $toKey): void
    {
        if ($fromKey === $toKey) {
            return;
        }

        foreach ($this->rowsAt($fromKey) as $row) {
            $newKey = $toKey.substr($row->storage_key, strlen($fromKey));
            DocYjsState::query()->where('storage_key_hash', self::keyHash($newKey))->delete();
            $row->storage_key = $newKey;
            $row->storage_key_hash = self::keyHash($newKey);
            $row->save();
        }
    }

    /** The document, or every document under a deleted folder. */
    private function delete(string $key): void
    {
        $ids = $this->rowsAt($key)->modelKeys();
        if ($ids !== []) {
            DocYjsState::query()->whereKey($ids)->delete();
        }
    }

    private function find(string $documentKey): ?DocYjsState
    {
        return DocYjsState::query()->where('storage_key_hash', self::keyHash($documentKey))->first();
    }

    /**
     * Exact key plus everything under `key/`. SQL narrows by an indexed
     * prefix; the byte-exact check stays in PHP because a MySQL collation
     * may fold case.
     *
     * @return Collection<int, DocYjsState>
     */
    private function rowsAt(string $key): Collection
    {
        $prefix = $key.'/';

        return DocYjsState::query()
            ->where(function ($query) use ($key, $prefix): void {
                $query->where('storage_key_hash', self::keyHash($key))
                    ->orWhereRaw("storage_key like ? escape '!'", [self::likePrefix($prefix)]);
            })
            ->get()
            ->filter(fn (DocYjsState $row): bool => $row->storage_key === $key
                || str_starts_with($row->storage_key, $prefix))
            ->values();
    }

    /** `!` as the escape character reads the same on SQLite, MySQL, and PostgreSQL. */
    private static function likePrefix(string $prefix): string
    {
        return str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $prefix).'%';
    }

    private static function keyHash(string $key): string
    {
        return hash('sha256', $key);
    }
}
