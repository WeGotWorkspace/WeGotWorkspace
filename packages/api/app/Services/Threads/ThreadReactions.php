<?php

declare(strict_types=1);

namespace App\Services\Threads;

use App\Exceptions\ApiHttpException;

/**
 * The reaction OR-set every thread entry carries in X-WGW-REACTIONS (#2173
 * chunk A). One person adds or removes their own emoji; an emoji with no
 * authors left is dropped. Order is kept, and a new emoji goes last.
 *
 * Only a new emoji is checked: it must be an emoji (at most
 * {@see self::MAX_GRAPHEMES} graphemes) and the entry may hold at most
 * {@see self::MAX_DISTINCT} different emoji. Joining or leaving an emoji
 * that is already there always works, so stored data stays usable.
 */
final class ThreadReactions
{
    public const MAX_DISTINCT = 20;

    public const MAX_GRAPHEMES = 3;

    /**
     * One emoji grapheme: a pictographic sequence (skin tones, variation
     * selectors, ZWJ joins, tag sequences), a flag, or a keycap.
     */
    private const GRAPHEME = '/^(?:'
        .'\p{Extended_Pictographic}[\x{FE0F}\x{1F3FB}-\x{1F3FF}]*(?:[\x{E0020}-\x{E007E}]+\x{E007F})?'
        .'(?:\x{200D}\p{Extended_Pictographic}[\x{FE0F}\x{1F3FB}-\x{1F3FF}]*)*'
        .'|\p{Regional_Indicator}{2}'
        .'|[#*0-9]\x{FE0F}?\x{20E3}'
        .')$/u';

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
            if (! self::isEmoji($emoji)) {
                throw new ApiHttpException(422, 'A reaction must be an emoji.', 'invalid_emoji');
            }
            if (count($set) >= self::MAX_DISTINCT) {
                throw new ApiHttpException(422, 'This entry has the most different reactions it can hold ('.self::MAX_DISTINCT.').', 'too_many_reactions');
            }
            $result[] = ['emoji' => $emoji, 'authors' => [$username]];
        }

        return $result;
    }

    /** True for one to {@see self::MAX_GRAPHEMES} emoji graphemes and nothing else. */
    public static function isEmoji(string $value): bool
    {
        if ($value === '' || preg_match_all('/\X/u', $value, $matches) === false) {
            return false;
        }
        $graphemes = $matches[0];
        if ($graphemes === [] || count($graphemes) > self::MAX_GRAPHEMES) {
            return false;
        }
        foreach ($graphemes as $grapheme) {
            if (preg_match(self::GRAPHEME, $grapheme) !== 1) {
                return false;
            }
        }

        return true;
    }
}
