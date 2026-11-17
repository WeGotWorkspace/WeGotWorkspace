<?php

declare(strict_types=1);

namespace App\Services\Threads;

/**
 * The reaction OR-set every thread entry carries in X-WGW-REACTIONS (#2173
 * chunk A). One person adds or removes their own emoji; an emoji with no
 * authors left is dropped. Order is kept, and a new emoji goes last.
 */
final class ThreadReactions
{
    /**
     * @param  list<array{emoji: string, authors: list<string>}>  $set
     * @return list<array{emoji: string, authors: list<string>}>
     */
    public static function toggle(array $set, string $emoji, string $username): array
    {
        $result = [];
        $found = false;
        foreach ($set as $reaction) {
            if ($reaction['emoji'] !== $emoji) {
                $result[] = $reaction;

                continue;
            }
            $found = true;
            $authors = array_map('strval', $reaction['authors']);
            $authors = in_array($username, $authors, true)
                ? array_values(array_diff($authors, [$username]))
                : [...$authors, $username];
            if ($authors !== []) {
                $result[] = ['emoji' => $emoji, 'authors' => $authors];
            }
        }
        if (! $found) {
            $result[] = ['emoji' => $emoji, 'authors' => [$username]];
        }

        return $result;
    }
}
