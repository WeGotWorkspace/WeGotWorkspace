<?php

declare(strict_types=1);

namespace App\Services\Calendars\Availability\PublicLink;

use App\Exceptions\ApiHttpException;
use App\Models\CalendarAvailabilityLink;
use App\Models\Principal;
use App\Models\User;
use App\Services\Calendars\Availability\AvailabilityCalculator;

/**
 * The public side of the availability link: busy time of one person for the
 * link's token, last week to 26 weeks ahead, in whole UTC weeks. The same
 * calculator as the Team API runs, forced to time only; the Team switch is not
 * consulted. A week that could not be worked out completely fails the request
 * (503) instead of showing free time. Unknown, revoked, replaced and disabled
 * all answer the same 404.
 */
final class AvailabilityPublicFeedService
{
    public const WEEKS_BEFORE = 1;

    public const WEEKS_AHEAD = 26;

    private const WEEK_SECONDS = 604800;

    public function __construct(
        private readonly AvailabilityCalculator $calculator,
        private readonly AvailabilityPublicFeedBuilder $builder,
        private readonly AvailabilityPublicFeedRateLimiter $limiter,
    ) {}

    public function ics(string $token, string $ip, ?int $now = null): string
    {
        $token = self::normalize($token);
        $this->limiter->enter($ip);

        $link = $token === '' ? null : CalendarAvailabilityLink::findByRawToken($token);
        $username = $link === null ? null : self::enabledUsername((string) $link->principal_uri);
        if ($link === null || $username === null) {
            $this->limiter->miss($ip);
            throw new ApiHttpException(404, 'Availability link not found.', 'not_found');
        }
        $this->limiter->token((string) $link->token_hash);

        $thisWeek = self::mondayOf($now ?? time());
        $first = $thisWeek - self::WEEKS_BEFORE * self::WEEK_SECONDS;
        $weeks = [];
        for ($i = 0; $i <= self::WEEKS_BEFORE + self::WEEKS_AHEAD; $i++) {
            $weeks[] = $first + $i * self::WEEK_SECONDS;
        }
        $result = $this->calculator->publicBusyPeriods($username, $weeks);
        if (! $result->complete()) {
            throw new ApiHttpException(503, 'Availability could not be worked out right now.', 'unavailable', [], ['Retry-After' => 300]);
        }

        return $this->builder->build(
            $result,
            $first,
            $first + count($weeks) * self::WEEK_SECONDS,
            (string) $link->token_hash,
            $thisWeek,
            self::calendarName($username),
        );
    }

    private static function enabledUsername(string $principalUri): ?string
    {
        $username = str_starts_with($principalUri, 'principals/') ? substr($principalUri, strlen('principals/')) : '';
        if ($username === '') {
            return null;
        }

        return User::query()->where('username', $username)->where('enabled', true)->exists() ? $username : null;
    }

    /** "{Name}'s Availability" from the owner's display name; plain "Availability" when none is set. */
    private static function calendarName(string $username): string
    {
        $name = trim((string) (Principal::forUsername($username)->displayname ?? ''));
        $name = trim((string) preg_replace('/[\x00-\x1f\x7f]+/u', ' ', $name));

        return $name === '' ? 'Availability' : $name."'s Availability";
    }

    private static function normalize(string $token): string
    {
        $token = trim($token);

        return str_ends_with(strtolower($token), '.ics') ? substr($token, 0, -4) : $token;
    }

    private static function mondayOf(int $timestamp): int
    {
        $midnight = intdiv($timestamp, 86400) * 86400;

        return $midnight - ((int) gmdate('N', $midnight) - 1) * 86400;
    }
}
