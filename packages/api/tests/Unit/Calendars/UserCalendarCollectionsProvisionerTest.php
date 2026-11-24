<?php

declare(strict_types=1);

namespace Tests\Unit\Calendars;

use App\Dav\Server\WgwCalendarBackendFactory;
use App\Services\Calendars\CalendarCollectionUris;
use App\Services\Calendars\CalendarColorPalette;
use App\Services\Calendars\CollectionKind;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use App\Services\Chat\ChatCollectionUris;
use App\Services\Installer\InstallerSeeder;
use App\Services\Tasks\InboxTaskListProvisioner;
use Illuminate\Support\Facades\DB;
use Sabre\CalDAV\Backend\PDO as CalPDO;
use Sabre\CalDAV\Xml\Property\SupportedCalendarComponentSet;
use Tests\Support\SeedsWgwIdentity;
use Tests\Support\WgwDatabaseTestCase;

final class UserCalendarCollectionsProvisionerTest extends WgwDatabaseTestCase
{
    use SeedsWgwIdentity;

    public function test_fresh_user_seed_provisions_separated_event_and_task_collections(): void
    {
        app(InstallerSeeder::class)->seed(
            'provisioned-user',
            'longpassword',
            'Provisioned User',
            'provisioned@example.test',
            true,
            false,
        );

        $caldav = new CalPDO(DB::connection('wgw')->getPdo());
        $byUri = [];
        foreach ($caldav->getCalendarsForUser('principals/provisioned-user') as $calendar) {
            $byUri[(string) ($calendar['uri'] ?? '')] = $calendar;
        }

        $this->assertArrayHasKey(CalendarCollectionUris::EVENT_DEFAULT, $byUri);
        $this->assertArrayHasKey(CalendarCollectionUris::EVENT_HOME, $byUri);
        $this->assertArrayHasKey(CalendarCollectionUris::EVENT_WORK, $byUri);
        $this->assertArrayHasKey(InboxTaskListProvisioner::URI, $byUri);
        $this->assertArrayNotHasKey(CalendarCollectionUris::TASK_HOME, $byUri);
        $this->assertArrayNotHasKey(CalendarCollectionUris::TASK_WORK, $byUri);

        $this->assertArrayHasKey(CalendarCollectionUris::NOTE_GENERAL, $byUri);
        $this->assertSame(['VEVENT'], $this->componentSetFor($byUri[CalendarCollectionUris::EVENT_HOME]));
        $this->assertSame(['VTODO'], $this->componentSetFor($byUri[InboxTaskListProvisioner::URI]));
        $this->assertSame(['VJOURNAL'], $this->componentSetFor($byUri[CalendarCollectionUris::NOTE_GENERAL]));
        $this->assertSame('Personal', (string) ($byUri[CalendarCollectionUris::NOTE_GENERAL]['{DAV:}displayname'] ?? ''));
        $this->assertSame('Home', (string) ($byUri[CalendarCollectionUris::EVENT_HOME]['{DAV:}displayname'] ?? ''));
        $this->assertSame('Personal', (string) ($byUri[InboxTaskListProvisioner::URI]['{DAV:}displayname'] ?? ''));
        $this->assertSame(['Calendar', 'Home', 'Personal', 'Personal', 'Work'], $this->sortedNames($byUri));

        $eventColors = [
            $this->colorFor($byUri[CalendarCollectionUris::EVENT_DEFAULT]),
            $this->colorFor($byUri[CalendarCollectionUris::EVENT_HOME]),
            $this->colorFor($byUri[CalendarCollectionUris::EVENT_WORK]),
        ];
        $this->assertSame(CalendarColorPalette::forUri(CalendarCollectionUris::EVENT_DEFAULT), $eventColors[0]);
        $this->assertSame(CalendarColorPalette::forUri(CalendarCollectionUris::EVENT_HOME), $eventColors[1]);
        $this->assertSame(CalendarColorPalette::forUri(CalendarCollectionUris::EVENT_WORK), $eventColors[2]);
        $this->assertCount(3, array_unique($eventColors));
    }

    public function test_existing_user_keeps_their_collections_and_gets_no_second_personal(): void
    {
        $this->seedWgwUser('old-user', password: 'longpassword');
        $principalUri = 'principals/old-user';
        $caldav = new CalPDO(DB::connection('wgw')->getPdo());
        foreach ([
            ['tasks-inbox', 'Inbox', 'VTODO'],
            ['tasks-home', 'Home', 'VTODO'],
            ['tasks-work', 'Work', 'VTODO'],
            ['notes-general', 'General', 'VJOURNAL'],
        ] as [$uri, $name, $component]) {
            $caldav->createCalendar($principalUri, $uri, [
                '{DAV:}displayname' => $name,
                '{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set' => new SupportedCalendarComponentSet([$component]),
            ]);
        }

        app(UserCalendarCollectionsProvisioner::class)->ensureForPrincipal($principalUri);

        $byUri = [];
        foreach ($caldav->getCalendarsForUser($principalUri) as $calendar) {
            $byUri[(string) ($calendar['uri'] ?? '')] = $calendar;
        }
        $this->assertSame('Inbox', (string) $byUri['tasks-inbox']['{DAV:}displayname']);
        $this->assertSame('Home', (string) $byUri['tasks-home']['{DAV:}displayname']);
        $this->assertSame('General', (string) $byUri['notes-general']['{DAV:}displayname']);
        $this->assertNotContains('Personal', $this->sortedNames($byUri));
    }

    public function test_user_with_only_custom_lists_keeps_names_and_gets_the_undeletable_landing_collections(): void
    {
        $this->seedWgwUser('custom-user', password: 'longpassword');
        $principalUri = 'principals/custom-user';
        $caldav = new CalPDO(DB::connection('wgw')->getPdo());
        $caldav->createCalendar($principalUri, 'groceries', [
            '{DAV:}displayname' => 'Groceries',
            '{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set' => new SupportedCalendarComponentSet(['VTODO']),
        ]);
        $caldav->createCalendar($principalUri, 'ideas', [
            '{DAV:}displayname' => 'Ideas',
            '{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set' => new SupportedCalendarComponentSet(['VJOURNAL']),
        ]);

        app(UserCalendarCollectionsProvisioner::class)->ensureForPrincipal($principalUri);

        $byUri = [];
        foreach ($caldav->getCalendarsForUser($principalUri) as $calendar) {
            $byUri[(string) ($calendar['uri'] ?? '')] = $calendar;
        }
        $this->assertSame('Inbox', (string) $byUri['tasks-inbox']['{DAV:}displayname']);
        $this->assertSame('General', (string) $byUri['notes-general']['{DAV:}displayname']);
        $this->assertArrayNotHasKey('tasks-home', $byUri);
    }

    public function test_an_owned_chat_channel_does_not_count_as_a_notebook(): void
    {
        $this->seedWgwUser('chat-first', password: 'longpassword');
        $principalUri = 'principals/chat-first';
        app(WgwCalendarBackendFactory::class)->make()->createCollection(
            CollectionKind::ChatChannel,
            $principalUri,
            ChatCollectionUris::PREFIX_CHANNEL.'lunch',
            [
                '{DAV:}displayname' => 'Lunch',
                '{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set' => new SupportedCalendarComponentSet(['VJOURNAL']),
            ],
        );

        app(UserCalendarCollectionsProvisioner::class)->ensureForPrincipal($principalUri);

        $byUri = [];
        foreach ((new CalPDO(DB::connection('wgw')->getPdo()))->getCalendarsForUser($principalUri) as $calendar) {
            $byUri[(string) ($calendar['uri'] ?? '')] = $calendar;
        }
        $this->assertSame('Personal', (string) $byUri['notes-general']['{DAV:}displayname']);
    }

    public function test_provisioner_is_idempotent(): void
    {
        $this->seedWgwUser('repeat-user', password: 'longpassword');
        $provisioner = app(UserCalendarCollectionsProvisioner::class);

        $first = $provisioner->ensureForPrincipal('principals/repeat-user');
        $second = $provisioner->ensureForPrincipal('principals/repeat-user');

        $this->assertGreaterThan(0, $first['created']);
        $this->assertSame(0, $second['created']);
    }

    public function test_group_provisioner_creates_vevent_and_vtodo_calendars_for_group_slug(): void
    {
        $group = $this->seedWgwGroup('principals/groups/engineering', 'Engineering');
        $this->assertTrue(
            app(UserCalendarCollectionsProvisioner::class)->ensureForGroupPrincipal((string) $group->uri, 'Engineering'),
        );
        $this->assertFalse(
            app(UserCalendarCollectionsProvisioner::class)->ensureForGroupPrincipal((string) $group->uri, 'Engineering'),
        );

        $caldav = new CalPDO(DB::connection('wgw')->getPdo());
        $byUri = [];
        foreach ($caldav->getCalendarsForUser('principals/groups/engineering') as $calendar) {
            $byUri[(string) ($calendar['uri'] ?? '')] = $calendar;
        }

        $this->assertArrayHasKey('engineering', $byUri);
        $this->assertArrayHasKey('tasks-engineering', $byUri);
        $this->assertArrayHasKey(CalendarCollectionUris::groupNotebookCalDavUri('engineering'), $byUri);
        $this->assertSame(['VEVENT'], $this->componentSetFor($byUri['engineering']));
        $this->assertSame(['VTODO'], $this->componentSetFor($byUri['tasks-engineering']));
        $this->assertSame(['VJOURNAL'], $this->componentSetFor($byUri[CalendarCollectionUris::groupNotebookCalDavUri('engineering')]));
        $this->assertSame(CalendarColorPalette::forUri('engineering'), $this->colorFor($byUri['engineering']));
        $this->assertSame(
            CalendarColorPalette::forUri(CalendarCollectionUris::groupTaskListCalDavUri('engineering')),
            $this->colorFor($byUri['tasks-engineering']),
        );
    }

    /**
     * @param  array<string, array<string, mixed>>  $byUri
     * @return list<string>
     */
    private function sortedNames(array $byUri): array
    {
        $names = array_map(static fn (array $calendar): string => (string) ($calendar['{DAV:}displayname'] ?? ''), array_values($byUri));
        sort($names);

        return $names;
    }

    /**
     * @param  array<string, mixed>  $calendar
     * @return list<string>
     */
    private function componentSetFor(array $calendar): array
    {
        $property = $calendar['{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set'] ?? null;
        $this->assertInstanceOf(SupportedCalendarComponentSet::class, $property);

        return $property->getValue();
    }

    /**
     * @param  array<string, mixed>  $calendar
     */
    private function colorFor(array $calendar): string
    {
        $color = $calendar[CalendarColorPalette::PROPERTY] ?? null;
        $this->assertIsString($color);
        $this->assertNotSame('', trim($color));

        return trim($color);
    }
}
