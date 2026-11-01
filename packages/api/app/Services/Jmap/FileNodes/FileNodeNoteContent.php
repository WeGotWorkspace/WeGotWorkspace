<?php

declare(strict_types=1);

namespace App\Services\Jmap\FileNodes;

use App\Services\Notes\NoteMarkdownCodec;
use App\Services\Notes\NoteTag;
use App\Storage\StoragePaths;
use App\Storage\WgwStorage;

/**
 * The `note` property of FileNode/set: markdown files under .notes carry a
 * title and tags in their front matter, which a create or update may patch
 * without rewriting the body.
 */
final class FileNodeNoteContent
{
    public function __construct(
        private readonly NoteMarkdownCodec $codec,
        private readonly StoragePaths $paths,
        private readonly WgwStorage $storage,
    ) {}

    /**
     * The validated `note` property of a create or update, or null when
     * absent.
     *
     * @param  array<string, mixed>  $payload
     * @return array{title?: string, tags?: list<string>}|null
     *
     * @throws FileNodeSetError
     */
    public function patch(array $payload): ?array
    {
        if (! array_key_exists('note', $payload)) {
            return null;
        }
        $note = $payload['note'];
        if (! is_array($note) || array_is_list($note)) {
            throw new FileNodeSetError($this->invalidProperties('note must be an object.', ['note']));
        }
        $unsupported = array_diff(array_keys($note), ['title', 'tags']);
        if ($unsupported !== []) {
            throw new FileNodeSetError($this->invalidProperties(
                'Unsupported note properties: '.implode(', ', array_map(strval(...), $unsupported)).'.',
                ['note'],
            ));
        }
        $out = [];
        if (array_key_exists('title', $note)) {
            if (! is_string($note['title'])) {
                throw new FileNodeSetError($this->invalidProperties('note.title must be a string.', ['note']));
            }
            $out['title'] = $note['title'];
        }
        if (array_key_exists('tags', $note)) {
            if (! is_array($note['tags'])) {
                throw new FileNodeSetError($this->invalidProperties('note.tags must be an array.', ['note']));
            }
            $tags = [];
            foreach ($note['tags'] as $tag) {
                if (! is_string($tag)) {
                    throw new FileNodeSetError($this->invalidProperties('note.tags must be an array of strings.', ['note']));
                }
                $tags[] = $tag;
            }
            $out['tags'] = $tags;
        }

        return $out;
    }

    public function isNoteMarkdownKey(string $key, string $name): bool
    {
        return $this->paths->isNotePath('/'.ltrim($key, '/')) && $this->codec->isNoteFilename($name);
    }

    private function readMarkdown(string $key): string
    {
        $disk = $this->storage->files();
        try {
            return $disk->exists($key) ? (string) $disk->get($key) : '';
        } catch (\Throwable) {
            return '';
        }
    }

    /**
     * @param  array{title?: string, tags?: list<string>}|null  $note
     */
    private function compose(string $name, ?array $note, string $sourceMarkdown): string
    {
        $fallback = pathinfo($name, PATHINFO_FILENAME);
        [$title, $tags, $body] = $this->codec->parse($sourceMarkdown, $fallback);
        if ($note !== null) {
            if (array_key_exists('title', $note)) {
                $title = $note['title'] !== '' ? $note['title'] : $fallback;
            }
            if (array_key_exists('tags', $note)) {
                $submitted = $note['tags'];
                $merged = NoteTag::mergeForUpdate($submitted, $tags);
                if ($merged !== NoteTag::normalizeStored($submitted)) {
                    throw new FileNodeSetError($this->invalidProperties(
                        'A tag may only use letters a-z and hyphen.',
                        ['note'],
                    ));
                }
                $tags = $merged;
            }
        }

        return $this->codec->serialize($title, $tags, $body);
    }

    /**
     * The bytes to store: a plain file's blob as is; a note's blob (or the
     * stored markdown when only `note` changes) with the title and tags
     * patched into its front matter.
     *
     * @param  array{title?: string, tags?: list<string>}|null  $note
     */
    public function contentsForWrite(
        string $key,
        string $name,
        ?array $note,
        ?string $blobContents,
    ): string {
        $isNote = $this->isNoteMarkdownKey($key, $name);
        if ($note !== null && ! $isNote) {
            throw new FileNodeSetError($this->invalidProperties('note is only valid on markdown files under .notes.', ['note']));
        }
        if (! $isNote) {
            if ($blobContents === null) {
                throw new FileNodeSetError($this->invalidProperties('File nodes require a blobId.', ['blobId']));
            }

            return $blobContents;
        }

        $source = $blobContents ?? $this->readMarkdown($key);
        if ($note === null) {
            return $source;
        }

        return $this->compose($name, $note, $source);
    }

    /**
     * @param  list<string>  $properties
     * @return array<string, mixed>
     */
    private function invalidProperties(string $description, array $properties = []): array
    {
        return ['type' => 'invalidProperties', 'description' => $description, 'properties' => $properties];
    }
}
