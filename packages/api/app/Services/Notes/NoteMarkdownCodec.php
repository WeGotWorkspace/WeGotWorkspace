<?php

declare(strict_types=1);

namespace App\Services\Notes;

/**
 * Frontmatter + body codec for note markdown files (pure PHP, no I/O).
 */
final class NoteMarkdownCodec
{
    public function isNoteFilename(string $filename): bool
    {
        if (! str_ends_with(strtolower($filename), '.md')) {
            return false;
        }

        return ! str_starts_with($filename, '._');
    }

    /**
     * @return array{0: string, 1: list<string>, 2: bool|null, 3: string, 4: string|null}
     */
    public function parse(string $markdown, string $fallbackTitle): array
    {
        $normalized = str_replace(["\r\n", "\r"], "\n", $markdown);
        $token = "\n----\n";
        $idx = strpos($normalized, $token);
        $headerText = $idx !== false ? substr($normalized, 0, $idx) : '';
        $body = $idx !== false ? substr($normalized, $idx + strlen($token)) : $normalized;
        $title = $fallbackTitle;
        $tags = [];
        $starred = null;
        $updated = null;
        foreach (array_filter(array_map('trim', explode("\n", $headerText))) as $line) {
            $sep = strpos($line, ':');
            if ($sep === false || $sep <= 0) {
                continue;
            }
            $key = strtolower(trim(substr($line, 0, $sep)));
            $value = trim(substr($line, $sep + 1));
            if ($key === 'title') {
                $title = $value !== '' ? $value : $fallbackTitle;

                continue;
            }
            if ($key === 'tags') {
                $tags = $this->normalizeTags(explode(',', $value));

                continue;
            }
            if ($key === 'starred') {
                $starred = $this->toBool($value);

                continue;
            }
            if ($key === 'updated') {
                $updated = $value !== '' ? $value : null;
            }
        }

        return [$title, $tags, $starred, $body, $updated];
    }

    /**
     * Metadata "updated" marker for a note, or null when the frontmatter does
     * not yet carry one (legacy notes fall back to file mtime at read time).
     */
    public function updatedOf(string $markdown): ?string
    {
        return $this->parse($markdown, '')[4];
    }

    /**
     * @param  list<string>  $tags
     * @param  string|null  $updated  metadata timestamp to stamp into frontmatter;
     *                                when null a fresh `now` marker is written so
     *                                metadata mutations advance the note's state.
     */
    public function serialize(string $title, array $tags, ?bool $starred, string $body, ?string $updated = null): string
    {
        $lines = [
            'title: '.trim(str_replace("\n", ' ', $title)),
            'tags: '.implode(', ', $tags),
        ];
        if ($starred !== null) {
            $lines[] = 'starred: '.($starred ? 'true' : 'false');
        }
        $lines[] = 'updated: '.($updated !== null && $updated !== '' ? $updated : date('c'));
        $normalizedBody = str_replace(["\r\n", "\r"], "\n", $body);

        return implode("\n", $lines)."\n----\n".$normalizedBody;
    }

    /**
     * Extract only the body section of an existing note markdown document.
     */
    public function bodyOf(string $markdown): string
    {
        [, , , $body] = $this->parse($markdown, '');

        return $body;
    }

    /**
     * List-row preview for Notes UI (no separate title field).
     *
     * Prefer the body section; frontmatter often stays `Untitled` after collab
     * body edits. Empty/Untitled titles (and titles that are only the note id)
     * fall through to body, then an empty string — never surface raw note ids
     * like `local-*` as the list title.
     */
    public function listPreview(string $markdown, string $fallbackId, int $maxLen = 180): string
    {
        [$title, , , $body] = $this->parse($markdown, $fallbackId);
        $fromBody = $this->plainPreviewText($body);
        if ($fromBody !== '') {
            return $this->truncatePreview($fromBody, $maxLen);
        }
        $fromTitle = trim($title);
        if (
            $fromTitle !== ''
            && strcasecmp($fromTitle, 'Untitled') !== 0
            && $fromTitle !== $fallbackId
        ) {
            return $this->truncatePreview($fromTitle, $maxLen);
        }

        return '';
    }

    private function plainPreviewText(string $markdown): string
    {
        $text = str_replace(["\r\n", "\r"], "\n", $markdown);
        // Light markdown strip so list rows match client noteListTitle / plain text.
        // GFM task lists: drop `- [ ]` / `- [x]` (and bare `[ ]`) so previews read as prose.
        $text = preg_replace('/^\s*[-*+]\s+\[[ xX]\]\s*/m', '', $text) ?? $text;
        $text = preg_replace('/\[[ xX]\]\s*/', '', $text) ?? $text;
        $text = preg_replace('/^#{1,6}\s+/m', '', $text) ?? $text;
        $text = preg_replace('/^\s*[-*+]\s+/m', '', $text) ?? $text;
        $text = preg_replace('/\[([^\]]+)\]\([^)]+\)/', '$1', $text) ?? $text;
        $text = preg_replace('/(\*\*|__)(.*?)\1/', '$2', $text) ?? $text;
        $text = preg_replace('/(\*|_)(.*?)\1/', '$2', $text) ?? $text;
        $text = preg_replace('/`([^`]+)`/', '$1', $text) ?? $text;
        $text = preg_replace('/\s+/u', ' ', $text) ?? $text;

        return trim($text);
    }

    private function truncatePreview(string $text, int $maxLen): string
    {
        if ($maxLen < 1 || mb_strlen($text) <= $maxLen) {
            return $text;
        }

        return mb_substr($text, 0, $maxLen - 1).'…';
    }

    /**
     * Re-serialize with new frontmatter while preserving the existing body bytes.
     *
     * Used by metadata-only mutations so updating title/tags/starred never
     * clobbers a body that may have been written by the collab persistence path.
     * A fresh `updated` marker is stamped because this is a metadata mutation.
     *
     * @param  list<string>  $tags
     */
    public function withFrontmatter(
        string $existingMarkdown,
        string $title,
        array $tags,
        ?bool $starred,
        string $fallbackTitle,
    ): string {
        [, , , $body] = $this->parse($existingMarkdown, $fallbackTitle);

        return $this->serialize($title !== '' ? $title : $fallbackTitle, $tags, $starred, $body);
    }

    /**
     * Replace the body section while preserving the existing frontmatter.
     *
     * Used by the collab body persistence path so saving body content never
     * clobbers the frontmatter owned by the Notes metadata API. The metadata
     * `updated` marker is preserved (not bumped) so a body-only collab save
     * does not perturb the note's metadata state — that prevents spurious
     * "server newer" conflicts when an offline metadata change later flushes
     * with a pre-body-edit `ifInState`.
     *
     * @param  string|null  $preservedUpdated  metadata marker to keep; when null
     *                                         the existing frontmatter marker is
     *                                         reused (falling back to a fresh one
     *                                         only for notes that never had one).
     */
    public function replaceBody(
        string $existingMarkdown,
        string $newBody,
        string $fallbackTitle,
        ?string $preservedUpdated = null,
    ): string {
        [$title, $tags, $starred, , $updated] = $this->parse($existingMarkdown, $fallbackTitle);

        return $this->serialize($title, $tags, $starred, $newBody, $preservedUpdated ?? $updated);
    }

    /**
     * @return list<string>
     */
    public function normalizeTags(mixed $value): array
    {
        if (! is_array($value)) {
            return [];
        }
        $out = [];
        foreach ($value as $tag) {
            if (! is_string($tag)) {
                continue;
            }
            $normalized = strtolower(trim(str_replace(["\r", "\n"], ' ', $tag)));
            if ($normalized === '') {
                continue;
            }
            $out[$normalized] = true;
        }

        return array_keys($out);
    }

    public function toBool(mixed $value): ?bool
    {
        if (is_bool($value)) {
            return $value;
        }
        if (is_string($value)) {
            $lower = strtolower(trim($value));
            if (in_array($lower, ['1', 'true', 'yes', 'on'], true)) {
                return true;
            }
            if (in_array($lower, ['0', 'false', 'no', 'off'], true)) {
                return false;
            }
        }
        if (is_int($value)) {
            return $value === 1 ? true : ($value === 0 ? false : null);
        }

        return null;
    }
}
