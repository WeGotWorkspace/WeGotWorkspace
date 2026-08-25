<?php

declare(strict_types=1);

namespace App\Services\Calendars;

use App\Exceptions\ApiHttpException;
use App\Models\CalendarFeedToken;
use App\Support\ApiUrlBuilder;
use Illuminate\Support\Str;

final class CalendarFeedService
{
    public function __construct(
        private readonly CalendarRepository $calendars,
        private readonly CalendarFeedIcsBuilder $builder,
        private readonly CalendarFeedRateLimiter $rateLimiter,
        private readonly ApiUrlBuilder $urls,
    ) {}

    /**
     * @return array{httpsUrl: string, webcalUrl: string}
     */
    public function show(string $username, string $calendarId): array
    {
        $this->assertPublishable($username, $calendarId);
        $row = CalendarFeedToken::query()
            ->where('owner_username', $username)
            ->where('calendar_uri', $calendarId)
            ->first();
        if ($row === null) {
            throw new ApiHttpException(404, 'Calendar feed not found.', 'not_found');
        }

        return $this->urlsFor($this->rawToken($row));
    }

    /**
     * @return array{created: bool, feed: array{httpsUrl: string, webcalUrl: string}}
     */
    public function publish(string $username, string $calendarId): array
    {
        $this->assertPublishable($username, $calendarId);
        $existing = CalendarFeedToken::query()
            ->where('owner_username', $username)
            ->where('calendar_uri', $calendarId)
            ->first();
        if ($existing !== null) {
            return ['created' => false, 'feed' => $this->urlsFor($this->rawToken($existing))];
        }

        $raw = Str::lower(Str::random(48));
        CalendarFeedToken::query()->create([
            'token_hash' => CalendarFeedToken::hashRaw($raw),
            // Encrypted so show()/publish() can return the same public URL.
            // RSVP tokens are hash-only and cannot be redisplayed.
            'token_cipher' => $raw,
            'owner_username' => $username,
            'calendar_uri' => $calendarId,
        ]);

        return ['created' => true, 'feed' => $this->urlsFor($raw)];
    }

    public function revoke(string $username, string $calendarId): void
    {
        $this->assertPublishable($username, $calendarId);
        $deleted = CalendarFeedToken::query()
            ->where('owner_username', $username)
            ->where('calendar_uri', $calendarId)
            ->delete();
        if ($deleted === 0) {
            throw new ApiHttpException(404, 'Calendar feed not found.', 'not_found');
        }
    }

    public function publicIcs(string $token, string $ip): string
    {
        $token = $this->normalizePublicToken($token);
        if (! $this->rateLimiter->allow($ip, $token)) {
            throw new ApiHttpException(429, 'Too many attempts. Please try again later.', 'throttled');
        }

        $row = CalendarFeedToken::findByRawToken($token);
        if ($row === null) {
            throw new ApiHttpException(404, 'Calendar feed not found.', 'not_found');
        }

        $instance = $this->calendars->findAccessibleCalendar(
            (string) $row->owner_username,
            (string) $row->calendar_uri,
        );
        if ($instance === null) {
            throw new ApiHttpException(404, 'Calendar feed not found.', 'not_found');
        }

        return $this->builder->build($instance);
    }

    private function assertPublishable(string $username, string $calendarId): void
    {
        $this->calendars->findPublishableCalendar($username, $calendarId);
        if ($this->calendars->isSubscriptionCalendar($username, $calendarId)) {
            throw new ApiHttpException(403, 'Subscription calendars cannot be published.', 'forbidden');
        }
    }

    /**
     * @return array{httpsUrl: string, webcalUrl: string}
     */
    private function urlsFor(string $raw): array
    {
        $https = $this->urls->v1('calendars/feeds/'.$raw);

        return [
            'httpsUrl' => $https,
            'webcalUrl' => (string) preg_replace('#^https?://#i', 'webcal://', $https),
        ];
    }

    private function rawToken(CalendarFeedToken $row): string
    {
        $raw = (string) $row->token_cipher;
        if ($raw === '') {
            throw new ApiHttpException(404, 'Calendar feed not found.', 'not_found');
        }

        return $raw;
    }

    private function normalizePublicToken(string $token): string
    {
        $token = trim($token);
        if (str_ends_with(strtolower($token), '.ics')) {
            $token = substr($token, 0, -4);
        }

        return $token;
    }
}
