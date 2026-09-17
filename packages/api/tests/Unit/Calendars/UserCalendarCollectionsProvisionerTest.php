<?php

declare(strict_types=1);

namespace Tests\Unit\Calendars;

use App\Services\Calendars\CalendarCollectionUris;
use App\Services\Calendars\CalendarColorPalette;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
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
        $this->assertArrayHasKey(CalendarCollectionUris::TASK_HOME, $byUri);
        $this->assertArrayHasKey(CalendarCollectionUris::TASK_WORK, $byUri);

        $this->assertArrayHasKey(CalendarCollectionUris::NOTE_GENERAL, $byUri);
        $this->assertSame(['VEVENT'], $this->componentSetFor($byUri[CalendarCollectionUris::EVENT_HOME]));
        $this->assertSame(['VTODO'], $this->componentSetFor($byUri[CalendarCollectionUris::TASK_HOME]));
        $this->assertSame(['VJOURNAL'], $this->componentSetFor($byUri[CalendarCollectionUris::NOTE_GENERAL]));
        $this->assertSame('General', (string) ($byUri[CalendarCollectionUris::NOTE_GENERAL]['{DAV:}displayname'] ?? ''));
        $this->assertSame('Home', (string) ($byUri[CalendarCollectionUris::EVENT_HOME]['{DAV:}displayname'] ?? ''));
        $this->assertSame('Home', (string) ($byUri[CalendarCollectionUris::TASK_HOME]['{DAV:}displayname'] ?? ''));

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
