<?php

declare(strict_types=1);

namespace App\Services\Rtc;

/**
 * Video send profiles, best first. A profile caps resolution and bitrate;
 * `audio` sends no camera at all. Admin settings choose a ceiling, never an
 * exact profile — which profile a client sends stays automatic.
 */
final class MeetVideoProfile
{
    public const P720 = 'p720';

    public const P360 = 'p360';

    public const P270 = 'p270';

    public const P180 = 'p180';

    public const AUDIO = 'audio';

    /** @var list<string> Best first, so a later position is the lower quality. */
    public const RANKED = [self::P720, self::P360, self::P270, self::P180, self::AUDIO];

    public static function normalize(mixed $value, string $fallback): string
    {
        return is_string($value) && in_array($value, self::RANKED, true) ? $value : $fallback;
    }

    /** The lower quality of the two, so neither ceiling is exceeded. */
    public static function clamp(string $profile, string $ceiling): string
    {
        $profileRank = array_search($profile, self::RANKED, true);
        $ceilingRank = array_search($ceiling, self::RANKED, true);
        if ($profileRank === false || $ceilingRank === false) {
            return $profile;
        }

        return self::RANKED[max($profileRank, $ceilingRank)];
    }
}
