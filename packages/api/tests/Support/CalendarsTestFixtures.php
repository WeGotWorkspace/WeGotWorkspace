<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Dav\Server\WgwCalendarBackendFactory;
use App\Models\Principal;
use App\Models\User;
use App\Services\Auth\AdminRoleResolver;
use App\Services\Calendars\CollectionKind;
use App\Support\WgwSettings;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Sabre\CalDAV\Backend\PDO as CalPDO;
use Sabre\CalDAV\Xml\Property\SupportedCalendarComponentSet;

/**
 * Shared CalDAV PDO fixtures for Calendars REST feature tests.
 */
trait CalendarsTestFixtures
{
    use WgwRoleFixtures;

    protected function setUpCalendarsFixtures(): void
    {
        putenv('WGW_DISABLE_LOGIN_THROTTLE=1');
        $_ENV['WGW_DISABLE_LOGIN_THROTTLE'] = '1';

        $this->configureWgwJwtKeys();
        config(['wgw.auth_realm' => 'SabreDAV']);
        $this->setAppSetting('auth_realm', 'SabreDAV');
        $this->setAppSetting(WgwSettings::CALENDAR_ENABLED, true);
        $this->seedCalendarsRoleMatrix();
    }

    protected function seedCalendarsRoleMatrix(): void
    {
        if (User::query()->where('username', 'bob')->exists()) {
            return;
        }

        $this->seedWgwUser('bob', displayName: 'Bob');
        $this->seedWgwUser('alice', displayName: 'Alice');
        $this->seedWgwUser('carol', displayName: 'Carol');

        $alice = Principal::forUsername('alice');
        $this->assertNotNull($alice);
        $adminGroup = $this->seedWgwGroup(AdminRoleResolver::ADMIN_GROUP_URI, 'Administrators');
        $this->addPrincipalToGroup($adminGroup, $alice);
        if ($this->calendarFixtureUsersShareATeam()) {
            $this->joinCalendarFixtureTeam('bob', 'carol');
        }

        $this->seedDefaultCalendarFor('bob');
        $this->seedDefaultCalendarFor('carol');
    }

    /**
     * bob and carol share the Team `calendar-fixture`, so they schedule each other
     * locally (#1923: someone outside your Teams is invited as an external guest).
     * Tests about the Team boundary return false and build their own Teams.
     */
    protected function calendarFixtureUsersShareATeam(): bool
    {
        return true;
    }

    /** Adds users to the shared fixture Team (created on first use). */
    protected function joinCalendarFixtureTeam(string ...$usernames): void
    {
        Principal::query()->firstOrCreate(['uri' => 'principals/groups'], ['displayname' => 'Groups', 'email' => null]);
        $uri = 'principals/groups/calendar-fixture';
        $team = Principal::query()->where('uri', $uri)->first() ?? $this->seedWgwGroup($uri, 'Calendar fixture');
        foreach ($usernames as $username) {
            $member = Principal::forUsername($username);
            $this->assertNotNull($member);
            $this->addPrincipalToGroup($team, $member);
        }
    }

    protected function seedDefaultCalendarFor(string $username): void
    {
        $backend = app(WgwCalendarBackendFactory::class)->make();
        $principalUri = 'principals/'.$username;

        foreach ($backend->getCalendarsForUser($principalUri) as $cal) {
            if (($cal['uri'] ?? '') === 'default') {
                return;
            }
        }

        $backend->createCollection(CollectionKind::EventCalendar, $principalUri, 'default', [
            '{DAV:}displayname' => 'Calendar',
            '{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set' => new SupportedCalendarComponentSet(['VEVENT', 'VJOURNAL']),
        ]);
    }

    protected function seedNamedCalendarFor(string $username, string $uri, string $displayName): void
    {
        app(WgwCalendarBackendFactory::class)->make()->createCollection(
            CollectionKind::EventCalendar,
            'principals/'.$username,
            $uri,
            [
                '{DAV:}displayname' => $displayName,
                '{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set' => new SupportedCalendarComponentSet(['VEVENT', 'VJOURNAL']),
            ],
        );
    }

    protected function seedEventViaPdo(
        string $username,
        string $eventUri,
        string $ics,
        string $calendarUri = 'default',
    ): string {
        $caldav = new CalPDO(DB::connection('wgw')->getPdo());
        $backendCalendarId = $this->resolveCalendarBackendId($username, $calendarUri);
        $caldav->createCalendarObject($backendCalendarId, $eventUri, $ics);

        return str_ends_with($eventUri, '.ics')
            ? substr($eventUri, 0, -4)
            : $eventUri;
    }

    protected function sampleIcs(
        string $summary = 'Team Meeting',
        ?string $uid = null,
        ?string $start = null,
        ?string $end = null,
    ): string {
        $uid ??= 'urn:uuid:'.Str::uuid()->toString();
        $start ??= gmdate('Ymd\THis\Z', strtotime('+1 day 10:00 UTC'));
        $end ??= gmdate('Ymd\THis\Z', strtotime('+1 day 11:00 UTC'));

        return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:{$uid}\r\nSUMMARY:{$summary}\r\nDTSTART:{$start}\r\nDTEND:{$end}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
    }

    /**
     * @return array<string, mixed>
     */
    protected function sampleCalendarEventPayload(string $calendarId = 'default'): array
    {
        return [
            'calendarIds' => [$calendarId => true],
            'title' => 'New Event',
            'start' => gmdate('Y-m-d\TH:i:s\Z', strtotime('+2 days 14:00 UTC')),
            'end' => gmdate('Y-m-d\TH:i:s\Z', strtotime('+2 days 15:00 UTC')),
        ];
    }

    /**
     * @return array{0: int, 1: int}
     */
    private function resolveCalendarBackendId(string $username, string $calendarUri): array
    {
        $caldav = new CalPDO(DB::connection('wgw')->getPdo());
        foreach ($caldav->getCalendarsForUser('principals/'.$username) as $cal) {
            if (($cal['uri'] ?? '') === $calendarUri) {
                $id = $cal['id'] ?? null;
                if (is_array($id)) {
                    return [(int) $id[0], (int) $id[1]];
                }

                throw new \RuntimeException("Calendar {$calendarUri} for {$username} is missing instance id.");
            }
        }

        throw new \RuntimeException("Calendar {$calendarUri} not found for {$username}.");
    }
}
