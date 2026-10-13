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
     * @return array{httpsUrl: string, webcalUrl: string, mode: string}
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

        return $this->feedPayload($this->rawToken($row), $this->storedMode($row));
    }

    /**
     * @param  array<mixed>  $payload
     * @return array{created: bool, feed: array{httpsUrl: string, webcalUrl: string, mode: string}}
     */
    public function publish(string $username, string $calendarId, array $payload = []): array
    {
        $this->assertPublishable($username, $calendarId);
        $mode = $this->requestedMode($payload);
        $existing = CalendarFeedToken::query()
            ->where('owner_username', $username)
            ->where('calendar_uri', $calendarId)
            ->first();
        if ($existing !== null) {
            if ($mode !== null && $this->storedMode($existing) !== $mode) {
                $existing->mode = $mode;
                $existing->save();
            }

            return [
                'created' => false,
                'feed' => $this->feedPayload($this->rawToken($existing), $this->storedMode($existing)),
            ];
        }

        $raw = Str::lower(Str::random(48));
        $stored = $mode ?? 'full';
        CalendarFeedToken::query()->create([
            'token_hash' => CalendarFeedToken::hashRaw($raw),
            // Encrypted so show()/publish() can return the same public URL.
            // RSVP tokens are hash-only and cannot be redisplayed.
            'token_cipher' => $raw,
            'owner_username' => $username,
            'calendar_uri' => $calendarId,
            'mode' => $stored,
        ]);

        return ['created' => true, 'feed' => $this->feedPayload($raw, $stored)];
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

        return $this->builder->build($instance, $this->storedMode($row));
    }

    /**
     * @param  array<mixed>  $payload
     */
    private function requestedMode(array $payload): ?string
    {
        if ($payload === []) {
            return null;
        }
        if (array_is_list($payload)) {
            throw new ApiHttpException(400, 'Feed publish body must be an object.', 'bad_request');
        }
        foreach (array_keys($payload) as $key) {
            if (is_string($key) && $key === 'mode') {
                continue;
            }
            throw new ApiHttpException(
                400,
                'Unsupported feed publish field.',
                'bad_request',
                [is_string($key) ? $key : 'mode'],
            );
        }
        if (! array_key_exists('mode', $payload)) {
            return null;
        }
        $mode = $payload['mode'];
        if ($mode !== 'full' && $mode !== 'busy') {
            throw new ApiHttpException(400, 'mode must be full or busy.', 'bad_request', ['mode']);
        }

        return $mode;
    }

    private function storedMode(CalendarFeedToken $row): string
    {
        return $row->mode === 'busy' ? 'busy' : 'full';
    }

    private function assertPublishable(string $username, string $calendarId): void
    {
        $this->calendars->findPublishableCalendar($username, $calendarId);
        if ($this->calendars->isSubscriptionCalendar($username, $calendarId)) {
            throw new ApiHttpException(403, 'Subscription calendars cannot be published.', 'forbidden');
        }
    }

    /**
     * @return array{httpsUrl: string, webcalUrl: string, mode: string}
     */
    private function feedPayload(string $raw, string $mode): array
    {
        $https = $this->urls->v1('calendars/feeds/'.$raw);

        return [
            'httpsUrl' => $https,
            'webcalUrl' => (string) preg_replace('#^https?://#i', 'webcal://', $https),
            'mode' => $mode,
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
