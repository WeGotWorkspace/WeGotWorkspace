<?php

declare(strict_types=1);

namespace App\Services\Calendars\Availability;

use App\Models\CalendarAvailabilityOwner;
use App\Models\CalendarAvailabilityPref;
use App\Models\CalendarInstance;
use App\Services\Calendars\CalendarCollectionAccess;
use Illuminate\Support\Carbon;

/**
 * An owner's Team availability choices: the master switch and, per own
 * personal or Team event calendar, whether it counts and how much teammates
 * see. No owner row means off; no pref row means included and `busy`.
 * Choices are kept while the switch is off.
 */
final class AvailabilitySettings
{
    public const DETAIL_BUSY = 'busy';

    public const DETAIL_DETAILS = 'details';

    public function __construct(
        private readonly CalendarCollectionAccess $collections,
    ) {}

    public function isEnabled(string $username): bool
    {
        return CalendarAvailabilityOwner::query()
            ->where('principal_uri', self::principalUri($username))
            ->where('enabled', true)
            ->exists();
    }

    public function setEnabled(string $username, bool $enabled): void
    {
        CalendarAvailabilityOwner::query()->updateOrInsert(
            ['principal_uri' => self::principalUri($username)],
            ['enabled' => $enabled, 'updated_at' => self::now()],
        );
    }

    /**
     * Stored choices by collection id. Calendars without a row are absent:
     * read them with {@see includes()} and {@see detail()}.
     *
     * @return array<int, array{include: bool, detail: string}>
     */
    public function prefs(string $username): array
    {
        $prefs = [];
        foreach (CalendarAvailabilityPref::query()->where('principal_uri', self::principalUri($username))->get() as $row) {
            $prefs[(int) $row->calendarid] = [
                'include' => (bool) $row->include,
                'detail' => $row->detail === self::DETAIL_DETAILS ? self::DETAIL_DETAILS : self::DETAIL_BUSY,
            ];
        }

        return $prefs;
    }

    /**
     * @param  array<int, array{include: bool, detail: string}>  $prefs
     */
    public static function includes(array $prefs, int $calendarId): bool
    {
        return $prefs[$calendarId]['include'] ?? true;
    }

    /**
     * @param  array<int, array{include: bool, detail: string}>  $prefs
     */
    public static function detail(array $prefs, int $calendarId): string
    {
        return $prefs[$calendarId]['detail'] ?? self::DETAIL_BUSY;
    }

    /**
     * Writes one calendar's choice; a null field keeps its current value.
     * Callers check that the calendar is one of the owner's sources and that
     * `details` is only set on a personal calendar.
     */
    public function setPref(string $username, int $calendarId, ?bool $include, ?string $detail): void
    {
        $current = $this->prefs($username)[$calendarId] ?? ['include' => true, 'detail' => self::DETAIL_BUSY];
        CalendarAvailabilityPref::query()->updateOrInsert(
            ['principal_uri' => self::principalUri($username), 'calendarid' => $calendarId],
            [
                'include' => $include ?? $current['include'],
                'detail' => $detail ?? $current['detail'],
                'updated_at' => self::now(),
            ],
        );
    }

    /**
     * The latest switch, include or detail change for this person, or null
     * when they never set anything. Any such change moves it.
     */
    public function settingsStamp(string $username): ?string
    {
        $principalUri = self::principalUri($username);
        $stamps = array_filter([
            CalendarAvailabilityOwner::query()->where('principal_uri', $principalUri)->max('updated_at'),
            CalendarAvailabilityPref::query()->where('principal_uri', $principalUri)->max('updated_at'),
        ], static fn (mixed $stamp): bool => is_string($stamp) && $stamp !== '');

        return $stamps === [] ? null : (string) max($stamps);
    }

    /**
     * The owner's own personal event calendars and their Team event calendars,
     * the same list the calculator reads.
     *
     * @return array{personal: list<CalendarInstance>, team: list<CalendarInstance>}
     */
    public function sourceCalendars(string $username): array
    {
        return $this->collections->availabilitySourceInstances($username);
    }

    public static function principalUri(string $username): string
    {
        return 'principals/'.$username;
    }

    private static function now(): string
    {
        return Carbon::now('UTC')->format('Y-m-d H:i:s.u');
    }
}
