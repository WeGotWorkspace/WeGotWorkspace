<?php

declare(strict_types=1);

namespace App\Services\Threads;

/**
 * Mentions as the server stores them (#2173): the client names who is
 * mentioned, the server names them. Each id is a lowercased username that
 * has a principal; unknown ids and repeats are dropped, and the display name
 * always comes from the principal directory, never from the client, so
 * "@Alice (Admin)" cannot point at bob.
 */
final class ThreadMentions
{
    /**
     * @return list<array{id: string, displayName: string}>
     */
    public static function resolve(mixed $raw): array
    {
        if (! is_array($raw)) {
            return [];
        }
        $ids = [];
        foreach ($raw as $entry) {
            if (! is_array($entry) || ! is_string($entry['id'] ?? null)) {
                continue;
            }
            $id = strtolower(trim($entry['id']));
            if ($id !== '') {
                $ids[$id] = $id;
            }
        }
        $names = ThreadAuthorNames::lookup(array_values($ids));
        $mentions = [];
        foreach ($ids as $id) {
            if (isset($names[$id])) {
                $mentions[] = ['id' => $id, 'displayName' => $names[$id]];
            }
        }

        return $mentions;
    }
}
