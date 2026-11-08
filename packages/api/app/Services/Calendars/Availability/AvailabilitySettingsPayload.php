<?php

declare(strict_types=1);

namespace App\Services\Calendars\Availability;

use App\Exceptions\ApiHttpException;
use App\Models\CalendarInstance;
use App\Models\Principal;
use App\Services\Calendars\CalendarRepository;
use App\Services\Drive\DriveGroupResolver;
use Illuminate\Support\Facades\DB;

/**
 * The REST resource `GET|PUT /calendars/availability`: the caller's switch,
 * their Teams, and one row per own personal or Team event calendar. A PUT is
 * checked in full before anything is written: a wrong type is 400, a
 * calendar that is not one of the caller's sources or `details` on a Team
 * calendar is 422.
 *
 * @phpstan-type SettingsCalendar array{calendarId: string, name: string, color: string|null, source: string, include: bool, detail: string}
 * @phpstan-type Settings array{enabled: bool, teams: list<array{slug: string, name: string}>, calendars: list<SettingsCalendar>}
 * @phpstan-type CalendarChange array{calendarId: string, include: bool|null, detail: string|null}
 */
final class AvailabilitySettingsPayload
{
    public const MAX_CALENDARS_PER_UPDATE = 200;

    private const SOURCE_PERSONAL = 'personal';

    private const SOURCE_TEAM = 'team';

    public function __construct(
        private readonly AvailabilitySettings $settings,
        private readonly CalendarRepository $calendars,
        private readonly DriveGroupResolver $groups,
    ) {}

    /** @return Settings */
    public function show(string $username): array
    {
        $prefs = $this->settings->prefs($username);
        $calendars = [];
        foreach ($this->sources($username) as $calendarId => [$instance, $source]) {
            $id = (int) $instance->calendarid;
            $name = trim((string) ($instance->displayname ?? ''));
            $color = is_string($instance->calendarcolor) ? trim($instance->calendarcolor) : '';
            $calendars[] = [
                'calendarId' => $calendarId,
                'name' => $name !== '' ? $name : (string) $instance->uri,
                'color' => $color !== '' ? $color : null,
                'source' => $source,
                'include' => AvailabilitySettings::includes($prefs, $id),
                'detail' => $source === self::SOURCE_TEAM
                    ? AvailabilitySettings::DETAIL_BUSY
                    : AvailabilitySettings::detail($prefs, $id),
            ];
        }

        return [
            'enabled' => $this->settings->isEnabled($username),
            'teams' => $this->teams($username),
            'calendars' => $calendars,
        ];
    }

    /** @return Settings */
    public function update(string $username, mixed $payload): array
    {
        [$enabled, $changes] = $this->parse($payload);
        $sources = $this->sources($username);
        $writes = [];
        foreach ($changes as $change) {
            $source = $sources[$change['calendarId']] ?? null;
            if ($source === null) {
                throw new ApiHttpException(422, 'calendarId is not one of your own personal or Team event calendars.', 'invalidProperties', ['calendars']);
            }
            if ($source[1] === self::SOURCE_TEAM && $change['detail'] === AvailabilitySettings::DETAIL_DETAILS) {
                throw new ApiHttpException(422, 'Team calendars only share busy time.', 'invalidProperties', ['calendars']);
            }
            $writes[] = [(int) $source[0]->calendarid, $change['include'], $change['detail']];
        }

        DB::connection('wgw')->transaction(function () use ($username, $enabled, $writes): void {
            if ($enabled !== null) {
                $this->settings->setEnabled($username, $enabled);
            }
            foreach ($writes as [$calendarId, $include, $detail]) {
                if ($include !== null || $detail !== null) {
                    $this->settings->setPref($username, $calendarId, $include, $detail);
                }
            }
        });

        return $this->show($username);
    }

    /**
     * @return array{0: bool|null, 1: list<CalendarChange>}
     */
    private function parse(mixed $payload): array
    {
        if (! is_array($payload) || ($payload !== [] && array_is_list($payload))) {
            throw new ApiHttpException(400, 'Body must be an object.', 'bad_request');
        }
        $unknown = array_diff(array_keys($payload), ['enabled', 'calendars']);
        if ($unknown !== []) {
            throw new ApiHttpException(400, 'Unknown field: '.implode(', ', $unknown).'.', 'invalidProperties', array_values(array_map('strval', $unknown)));
        }
        $enabled = $payload['enabled'] ?? null;
        if (array_key_exists('enabled', $payload) && ! is_bool($enabled)) {
            throw new ApiHttpException(400, 'enabled must be a boolean.', 'invalidProperties', ['enabled']);
        }

        $calendars = $payload['calendars'] ?? [];
        if (! is_array($calendars) || ! array_is_list($calendars) || count($calendars) > self::MAX_CALENDARS_PER_UPDATE) {
            throw new ApiHttpException(400, 'calendars must be a list of at most '.self::MAX_CALENDARS_PER_UPDATE.' items.', 'invalidProperties', ['calendars']);
        }

        return [$enabled, array_map(fn (mixed $item): array => $this->parseCalendar($item), $calendars)];
    }

    /** @return CalendarChange */
    private function parseCalendar(mixed $item): array
    {
        if (! is_array($item)
            || array_diff(array_keys($item), ['calendarId', 'include', 'detail']) !== []
            || ! is_string($item['calendarId'] ?? null)
            || (array_key_exists('include', $item) && ! is_bool($item['include']))
            || (array_key_exists('detail', $item) && ! in_array($item['detail'], [AvailabilitySettings::DETAIL_BUSY, AvailabilitySettings::DETAIL_DETAILS], true))
        ) {
            throw new ApiHttpException(400, 'Each calendar needs a calendarId string, an optional include boolean and an optional detail of busy or details.', 'invalidProperties', ['calendars']);
        }

        return [
            'calendarId' => $item['calendarId'],
            'include' => $item['include'] ?? null,
            'detail' => $item['detail'] ?? null,
        ];
    }

    /**
     * The caller's sources by JMAP Calendar id, in the calculator's order.
     *
     * @return array<string, array{0: CalendarInstance, 1: string}>
     */
    private function sources(string $username): array
    {
        $byId = [];
        $sources = $this->settings->sourceCalendars($username);
        foreach ([self::SOURCE_PERSONAL => $sources['personal'], self::SOURCE_TEAM => $sources['team']] as $source => $instances) {
            foreach ($instances as $instance) {
                $byId[$this->calendars->apiIdForInstance($instance)] = [$instance, $source];
            }
        }

        return $byId;
    }

    /** @return list<array{slug: string, name: string}> */
    private function teams(string $username): array
    {
        $teams = [];
        foreach ($this->groups->allowedGroupSlugs($username) as $slug) {
            $name = trim((string) (Principal::query()->where('uri', 'principals/groups/'.$slug)->value('displayname') ?? ''));
            $teams[] = ['slug' => $slug, 'name' => $name !== '' ? $name : $slug];
        }
        usort($teams, static fn (array $a, array $b): int => strcasecmp($a['name'], $b['name']) ?: strcmp($a['slug'], $b['slug']));

        return $teams;
    }
}
