<?php

declare(strict_types=1);

namespace App\Services\Notify;

use App\Models\Principal;

/**
 * Structured facts + copy for docs.shared: who shared which file, optional path.
 */
final class DocsSharedNotify
{
    /**
     * @return array{
     *     actor: string,
     *     path: string,
     *     fileName: string,
     *     navigate: string,
     *     tag: string
     * }
     */
    public static function eventData(string $actorLabel, string $path, string $shareId): array
    {
        $name = basename($path) ?: $path;
        $isDoc = str_ends_with(strtolower($path), '.md');

        return [
            'actor' => $actorLabel,
            'path' => $path,
            'fileName' => $name,
            'navigate' => $isDoc ? '/docs' : '/drive',
            'tag' => 'docs.shared:'.$shareId,
        ];
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array{title: string, body: string|null}
     */
    public static function formatCopy(array $data): array
    {
        $actor = trim((string) ($data['actor'] ?? ''));
        if ($actor === '') {
            $actor = 'Someone';
        }
        $fileName = trim((string) ($data['fileName'] ?? ''));
        $path = trim((string) ($data['path'] ?? ''));
        if ($fileName === '') {
            $fileName = $path !== '' ? (basename($path) ?: $path) : 'a document';
        }

        return [
            'title' => $actor.' shared '.$fileName.' with you',
            'body' => self::pathSubtitle($path !== '' ? $path : $fileName, $fileName),
        ];
    }

    public static function actorLabel(string $username): string
    {
        $trimmed = trim($username);
        if ($trimmed === '') {
            return 'Someone';
        }
        $principal = Principal::forUsername($trimmed);
        $name = trim((string) ($principal?->displayname ?? ''));

        return $name !== '' ? $name : $trimmed;
    }

    public static function pathSubtitle(string $path, string $name): ?string
    {
        $normalized = trim($path);
        if ($normalized === '' || $normalized === $name) {
            return null;
        }

        return $normalized;
    }
}
