<?php

declare(strict_types=1);

namespace App\Services\Calendars;

use App\Exceptions\ApiHttpException;
use App\Models\CalendarSubscription;
use App\Services\Admin\AdminConstants;
use Illuminate\Database\UniqueConstraintViolationException;
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
        return array_values(CalendarSubscription::query()
            ->where('username', $username)
            ->orderBy('id')
            ->get()
            ->map(fn (CalendarSubscription $row): array => $this->toArray($row))
            ->all());
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
        $groupSlug = isset($payload['groupSlug'])
            ? trim($payload['groupSlug'])
            : null;
        $calendar = $this->calendars->create($username, [
            'name' => $name,
            'color' => $color,
            ...($groupSlug !== null && $groupSlug !== '' ? ['groupSlug' => $groupSlug] : []),
        ]);
        $calendarId = (string) $calendar['id'];
        $principalUri = is_string($calendar['groupSlug'] ?? null) && $calendar['groupSlug'] !== ''
            ? AdminConstants::GROUP_PREFIX.$calendar['groupSlug']
            : 'principals/'.$username;
        // Calendar uris are only unique per principal: always address the calendar this
        // request created by principal and uri, never by uri alone.
        $instance = null;
        $rowInserted = false;
        $row = new CalendarSubscription([
            'id' => (string) Str::uuid(),
            'username' => $username,
            'principal_uri' => $principalUri,
            'calendar_uri' => $calendarId,
            'url' => $url,
            'name' => $name,
            'color' => $color,
            'last_fetched_at' => now(),
        ]);

        try {
            $instance = $this->calendars->findCalendarInstance($principalUri, $calendarId);
            if ($instance === null) {
                throw new ApiHttpException(500, 'Could not load subscription calendar.', 'server_error');
            }
            try {
                $row->save();
                $rowInserted = true;
            } catch (UniqueConstraintViolationException) {
                // A row this request did not insert stays; only the new calendar goes.
                throw new ApiHttpException(409, 'This calendar already has a subscription.', 'alreadyExists');
            } catch (\Throwable) {
                throw new ApiHttpException(500, 'The subscription could not be saved.', 'server_error');
            }
            try {
                $this->sync->sync($instance, $ics);
            } catch (ApiHttpException $exception) {
                throw $exception;
            } catch (\Throwable) {
                throw new ApiHttpException(400, 'The calendar feed could not be imported.', 'bad_request');
            }
        } catch (ApiHttpException $exception) {
            try {
                // Only the calendar this request created, and its own subscription row.
                // A failed lookup above is retried, so the new calendar is not left behind.
                $instance ??= $this->calendars->findCalendarInstance($principalUri, $calendarId);
                if ($instance !== null) {
                    $this->calendars->deleteCreatedInstance($instance, $rowInserted);
                }
            } catch (\Throwable) {
                // Best effort. The original failure is what the caller sees.
            }

            throw $exception;
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
        $instance = $this->calendars->findSubscriptionCalendar($username, (string) $row->principal_uri, (string) $row->calendar_uri);
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
            $this->calendars->deleteSubscriptionCalendar($username, (string) $row->principal_uri, (string) $row->calendar_uri);
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
