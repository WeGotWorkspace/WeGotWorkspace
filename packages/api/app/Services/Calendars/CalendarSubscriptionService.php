<?php

declare(strict_types=1);

namespace App\Services\Calendars;

use App\Exceptions\ApiHttpException;
use App\Models\CalendarSubscription;
use Illuminate\Support\Str;

final class CalendarSubscriptionService
{
    public function __construct(
        private readonly CalendarRepository $calendars,
        private readonly SsrfSafeIcsFetcher $fetcher,
        private readonly CalendarSubscriptionIcsSync $sync,
    ) {}

    /**
     * @return list<array<string, mixed>>
     */
    public function list(string $username): array
    {
        return CalendarSubscription::query()
            ->where('username', $username)
            ->orderBy('id')
            ->get()
            ->map(fn (CalendarSubscription $row): array => $this->toArray($row))
            ->all();
    }

    /**
     * @return array<string, mixed>
     */
    public function show(string $username, string $id): array
    {
        return $this->toArray($this->owned($username, $id));
    }

    /**
     * @param  array{url: string, name?: string, color?: string|null, groupSlug?: string|null}  $payload
     * @return array<string, mixed>
     */
    public function create(string $username, array $payload): array
    {
        $url = $this->fetcher->normalizeUrl((string) $payload['url']);
        $ics = $this->fetcher->fetch($url);
        $this->sync->documentsByUid($ics);

        $name = $this->subscriptionName($payload['name'] ?? null, $url, $ics);
        $color = $this->subscriptionColor($payload['color'] ?? null);
        $groupSlug = isset($payload['groupSlug']) && is_string($payload['groupSlug'])
            ? trim($payload['groupSlug'])
            : null;
        $calendar = $this->calendars->create($username, [
            'name' => $name,
            'color' => $color,
            ...($groupSlug !== null && $groupSlug !== '' ? ['groupSlug' => $groupSlug] : []),
        ]);
        $calendarId = (string) $calendar['id'];

        $row = new CalendarSubscription([
            'id' => (string) Str::uuid(),
            'username' => $username,
            'calendar_uri' => $calendarId,
            'url' => $url,
            'name' => $name,
            'color' => $color,
            'last_fetched_at' => now(),
        ]);

        try {
            $row->save();
            $instance = $this->calendars->findAccessibleCalendar($username, $calendarId);
            if ($instance === null) {
                throw new ApiHttpException(500, 'Could not load subscription calendar.', 'server_error');
            }
            $this->sync->sync($instance, $ics);
        } catch (\Throwable $exception) {
            $this->calendars->deleteIncludingContents($username, $calendarId);
            if ($exception instanceof ApiHttpException) {
                throw $exception;
            }

            throw new ApiHttpException(400, 'The calendar feed could not be imported.', 'bad_request');
        }

        $row->refresh();

        return $this->toArray($row);
    }

    /**
     * @return array<string, mixed>
     */
    public function refresh(string $username, string $id): array
    {
        $row = $this->owned($username, $id);
        $ics = $this->fetcher->fetch((string) $row->url);
        $instance = $this->calendars->findAccessibleCalendar($username, (string) $row->calendar_uri);
        if ($instance === null) {
            throw new ApiHttpException(404, 'Subscription calendar not found.', 'not_found');
        }

        $this->sync->sync($instance, $ics);
        $row->last_fetched_at = now();
        $row->save();

        return $this->toArray($row);
    }

    public function destroy(string $username, string $id): void
    {
        $row = $this->owned($username, $id);
        try {
            $this->calendars->deleteIncludingContents($username, (string) $row->calendar_uri);
        } catch (ApiHttpException $exception) {
            if ($exception->getStatusCode() !== 404) {
                throw $exception;
            }
            $row->delete();
        }
    }

    private function owned(string $username, string $id): CalendarSubscription
    {
        $row = CalendarSubscription::query()
            ->where('id', $id)
            ->where('username', $username)
            ->first();
        if ($row === null) {
            throw new ApiHttpException(404, 'Subscription not found.', 'not_found');
        }

        return $row;
    }

    /**
     * @return array<string, mixed>
     */
    private function toArray(CalendarSubscription $row): array
    {
        return [
            'id' => (string) $row->id,
            'url' => (string) $row->url,
            'name' => is_string($row->name) && $row->name !== '' ? $row->name : null,
            'color' => is_string($row->color) && $row->color !== '' ? $row->color : null,
            'calendarId' => (string) $row->calendar_uri,
            'lastFetchedAt' => $row->last_fetched_at?->toIso8601String(),
        ];
    }

    private function subscriptionName(mixed $name, string $url, string $ics): string
    {
        if (is_string($name) && trim($name) !== '') {
            return trim($name);
        }

        $fromIcs = $this->sync->calendarDisplayName($ics);
        if ($fromIcs !== null) {
            return $fromIcs;
        }

        return $this->nameFromUrl($url);
    }

    private function nameFromUrl(string $url): string
    {
        $path = parse_url($url, PHP_URL_PATH);
        if (is_string($path) && $path !== '') {
            $segment = basename($path);
            $stripped = preg_replace('/\.ics$/i', '', $segment) ?? $segment;
            $human = trim((string) preg_replace('/[-_]+/', ' ', rawurldecode($stripped)));
            if ($human !== '' && $human !== '/' && strcasecmp($human, 'ical') !== 0) {
                return $human;
            }
        }

        $host = parse_url($url, PHP_URL_HOST);
        if (is_string($host) && $host !== '') {
            return (string) preg_replace('/^www\./i', '', $host);
        }

        return 'Subscribed calendar';
    }

    private function subscriptionColor(mixed $color): ?string
    {
        return CalendarColorPalette::normalize($color);
    }
}
