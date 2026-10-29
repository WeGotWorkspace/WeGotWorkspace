<?php

declare(strict_types=1);

namespace App\Services\Calendars;

use App\Exceptions\ApiHttpException;
use App\Models\CalendarFeedToken;
use App\Models\CalendarInstance;
use App\Support\ApiUrlBuilder;
use Illuminate\Support\Str;
use Sabre\DAV\Sharing\Plugin as SharingPlugin;

final class CalendarFeedService
{
    public function __construct(
        private readonly CalendarRepository $calendars,
        private readonly CalendarFeedIcsBuilder $builder,
        private readonly CalendarFeedRateLimiter $rateLimiter,
        private readonly ApiUrlBuilder $urls,
    ) {}

    /**
     * The calendar's feed, for every principal who may publish the calendar.
     *
     * @return array{httpsUrl: string, webcalUrl: string, mode: string}
     */
    public function show(string $username, string $calendarId): array
    {
        $row = $this->feedOf($this->publishableCalendarId($username, $calendarId));
        if ($row === null) {
            throw new ApiHttpException(404, 'Calendar feed not found.', 'not_found');
        }

        return $this->feedPayload($this->rawToken($row), $this->storedMode($row));
    }

    /**
     * Publishes the calendar, or returns its existing feed. A calendar has at
     * most one feed, whoever published it; sending mode updates that feed.
     *
     * @param  array<mixed>  $payload
     * @return array{created: bool, feed: array{httpsUrl: string, webcalUrl: string, mode: string}}
     */
    public function publish(string $username, string $calendarId, array $payload = []): array
    {
        $calendar = $this->publishableCalendarId($username, $calendarId);
        $mode = $this->requestedMode($payload);
        $existing = $this->feedOf($calendar);
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
            'calendarid' => $calendar,
            'mode' => $stored,
        ]);

        return ['created' => true, 'feed' => $this->feedPayload($raw, $stored)];
    }

    /** Ends every public URL of the calendar, whoever published it. */
    public function revoke(string $username, string $calendarId): void
    {
        $deleted = CalendarFeedToken::query()
            ->where('calendarid', $this->publishableCalendarId($username, $calendarId))
            ->delete();
        if ($deleted === 0) {
            throw new ApiHttpException(404, 'Calendar feed not found.', 'not_found');
        }
    }

    /** Serves exactly the calendar the token was issued for. */
    public function publicIcs(string $token, string $ip): string
    {
        $token = $this->normalizePublicToken($token);
        if (! $this->rateLimiter->allow($ip, $token)) {
            throw new ApiHttpException(429, 'Too many attempts. Please try again later.', 'throttled');
        }

        $row = CalendarFeedToken::findByRawToken($token);
        $instance = $row === null ? null : $this->ownerInstance((int) $row->calendarid);
        if ($row === null || $instance === null) {
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
        return $row->mode === 'full' ? 'full' : 'busy';
    }

    /** Sabre calendar id of a calendar the user may publish. */
    private function publishableCalendarId(string $username, string $calendarId): int
    {
        $instance = $this->calendars->findPublishableCalendar($username, $calendarId);
        if ($this->calendars->isSubscriptionCalendar($username, $calendarId)) {
            throw new ApiHttpException(403, 'Subscription calendars cannot be published.', 'forbidden');
        }

        return (int) $instance->calendarid;
    }

    private function ownerInstance(int $calendarId): ?CalendarInstance
    {
        return CalendarInstance::query()
            ->where('calendarid', $calendarId)
            ->where('access', SharingPlugin::ACCESS_SHAREDOWNER)
            ->whereHas('calendar', fn ($query) => $query->supportsVevent())
            ->first();
    }

    /** The oldest feed of the calendar; tokens issued before feeds were per calendar may add more. */
    private function feedOf(int $calendarId): ?CalendarFeedToken
    {
        return CalendarFeedToken::query()
            ->where('calendarid', $calendarId)
            ->orderBy('id')
            ->first();
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
