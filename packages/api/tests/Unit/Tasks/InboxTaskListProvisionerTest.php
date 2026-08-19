<?php

declare(strict_types=1);

namespace Tests\Unit\Tasks;

use App\Models\User;
use App\Services\Calendars\CalendarCollectionUris;
use App\Services\Installer\InstallerSeeder;
use App\Services\Tasks\InboxTaskListProvisioner;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Sabre\CalDAV\Backend\PDO as CalPDO;
use Sabre\CalDAV\Xml\Property\SupportedCalendarComponentSet;
use Tests\Support\SeedsWgwIdentity;
use Tests\Support\WgwDatabaseTestCase;

final class InboxTaskListProvisionerTest extends WgwDatabaseTestCase
{
    use SeedsWgwIdentity;

    public function test_fresh_user_seed_creates_vtodo_only_inbox(): void
    {
        app(InstallerSeeder::class)->seed(
            'fresh-user',
            'longpassword',
            'Fresh User',
            'fresh@example.test',
            true,
            false,
        );

        $caldav = new CalPDO(DB::connection('wgw')->getPdo());
        $calendars = $caldav->getCalendarsForUser('principals/fresh-user');
        $byUri = [];
        foreach ($calendars as $calendar) {
            $byUri[(string) ($calendar['uri'] ?? '')] = $calendar;
        }

        $this->assertArrayHasKey('default', $byUri);
        $this->assertArrayHasKey(CalendarCollectionUris::EVENT_HOME, $byUri);
        $this->assertArrayHasKey(InboxTaskListProvisioner::URI, $byUri);
        $this->assertSame('tasks-inbox', InboxTaskListProvisioner::URI);
        $this->assertArrayNotHasKey(InboxTaskListProvisioner::LEGACY_URI, $byUri);
        $this->assertArrayHasKey(CalendarCollectionUris::TASK_HOME, $byUri);
        $this->assertSame(
            ['VEVENT', 'VJOURNAL'],
            $this->componentSetFor($byUri['default']),
        );
        $this->assertSame(['VTODO'], $this->componentSetFor($byUri[InboxTaskListProvisioner::URI]));
        $this->assertSame(['VTODO'], $this->componentSetFor($byUri[CalendarCollectionUris::TASK_HOME]));
        $this->assertSame(
            InboxTaskListProvisioner::DISPLAY_NAME,
            (string) ($byUri[InboxTaskListProvisioner::URI]['{DAV:}displayname'] ?? ''),
        );
    }

    public function test_provisioner_creates_inbox_for_legacy_user_without_one(): void
    {
        $this->seedWgwUser('legacy-user', password: 'longpassword');
        $principalUri = 'principals/legacy-user';

        $caldav = new CalPDO(DB::connection('wgw')->getPdo());
        $caldav->createCalendar($principalUri, 'default', [
            '{DAV:}displayname' => 'Calendar',
            '{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set' => new SupportedCalendarComponentSet(['VEVENT', 'VTODO', 'VJOURNAL']),
        ]);

        $provisioner = app(InboxTaskListProvisioner::class);
        $this->assertFalse($provisioner->hasInboxCalendar($principalUri));
        $this->assertTrue($provisioner->ensureForPrincipal($principalUri));
        $this->assertTrue($provisioner->hasInboxCalendar($principalUri));

        $inbox = $this->findCalendarByUri($principalUri, InboxTaskListProvisioner::URI);
        $this->assertNotNull($inbox);
        $this->assertSame(['VTODO'], $this->componentSetFor($inbox));
    }

    public function test_provisioner_is_idempotent_on_rerun(): void
    {
        $this->seedWgwUser('repeat-user', password: 'longpassword');
        $principalUri = 'principals/repeat-user';

        $provisioner = app(InboxTaskListProvisioner::class);
        $this->assertTrue($provisioner->ensureForPrincipal($principalUri));
        $this->assertFalse($provisioner->ensureForPrincipal($principalUri));

        $result = $provisioner->ensureForAllUsers();
        $this->assertSame(User::query()->count(), $result['scanned']);
        $this->assertSame(0, $result['created']);
        $this->assertSame(User::query()->count(), $result['skipped']);
    }

    public function test_artisan_command_provisions_inbox_for_users_missing_one(): void
    {
        $this->seedWgwUser('cmd-user', password: 'longpassword');
        $this->assertFalse(app(InboxTaskListProvisioner::class)->hasInboxCalendar('principals/cmd-user'));

        $exitCode = Artisan::call('wgw:tasks:provision-inbox');
        $this->assertSame(0, $exitCode);
        $this->assertTrue(app(InboxTaskListProvisioner::class)->hasInboxCalendar('principals/cmd-user'));

        $exitCode = Artisan::call('wgw:tasks:provision-inbox');
        $this->assertSame(0, $exitCode);
    }

    public function test_provisioner_migrates_legacy_inbox_uri_to_tasks_inbox(): void
    {
        $this->seedWgwUser('legacy-inbox', password: 'longpassword');
        $principalUri = 'principals/legacy-inbox';

        $caldav = new CalPDO(DB::connection('wgw')->getPdo());
        $caldav->createCalendar($principalUri, InboxTaskListProvisioner::LEGACY_URI, [
            '{DAV:}displayname' => InboxTaskListProvisioner::DISPLAY_NAME,
            '{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set' => new SupportedCalendarComponentSet(['VTODO']),
        ]);

        $this->assertNotNull($this->findCalendarByUri($principalUri, InboxTaskListProvisioner::LEGACY_URI));
        $this->assertNull($this->findCalendarByUri($principalUri, InboxTaskListProvisioner::URI));

        $provisioner = app(InboxTaskListProvisioner::class);
        $this->assertFalse($provisioner->ensureForPrincipal($principalUri));
        $this->assertTrue($provisioner->hasInboxCalendar($principalUri));
        $this->assertNull($this->findCalendarByUri($principalUri, InboxTaskListProvisioner::LEGACY_URI));
        $this->assertNotNull($this->findCalendarByUri($principalUri, InboxTaskListProvisioner::URI));
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
     * @return array<string, mixed>|null
     */
    private function findCalendarByUri(string $principalUri, string $uri): ?array
    {
        $caldav = new CalPDO(DB::connection('wgw')->getPdo());
        foreach ($caldav->getCalendarsForUser($principalUri) as $calendar) {
            if (($calendar['uri'] ?? '') === $uri) {
                return $calendar;
            }
        }

        return null;
    }
}
