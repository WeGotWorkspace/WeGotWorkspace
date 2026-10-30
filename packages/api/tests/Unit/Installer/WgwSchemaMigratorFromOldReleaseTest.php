<?php

declare(strict_types=1);

namespace Tests\Unit\Installer;

use App\Models\Principal;
use App\Models\User;
use App\Services\Calendars\CalendarCollectionUris;
use App\Services\Installer\WgwSchemaMigrator;
use App\Services\Tasks\InboxTaskListProvisioner;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Sabre\CalDAV\Backend\PDO as CalPDO;
use Sabre\CalDAV\Xml\Property\SupportedCalendarComponentSet;
use Tests\Support\WgwTestDatabase;
use Tests\TestCase;

/**
 * 0.1.70 shipped the wgw migrations up to 2026_07_02_000120. Updating such an
 * install with users in it must reach the current schema (#1076).
 */
final class WgwSchemaMigratorFromOldReleaseTest extends TestCase
{
    /** Last migration the 0.1.70 release ran. */
    private const LAST_IN_0_1_70 = '2026_07_02_000120_wgw_mail_user_credentials_updated_at_timestamp';

    private string $oldMigrations = '';

    private int $defaultCalendarId = 0;

    protected function setUp(): void
    {
        parent::setUp();
        WgwTestDatabase::configureConnection('sqlite');
    }

    protected function tearDown(): void
    {
        if ($this->oldMigrations !== '') {
            File::deleteDirectory($this->oldMigrations);
        }
        parent::tearDown();
    }

    public function test_install_with_a_user_and_calendar_data_from_0_1_70_reaches_current_schema(): void
    {
        $this->migrateAs0170();
        $this->seed0170User('admin');

        $migrator = app(WgwSchemaMigrator::class);
        $migrator->migrate();

        $this->assertSame(WgwSchemaMigrator::CURRENT_SCHEMA_VERSION, $migrator->currentVersion());
        $this->assertSame([], $migrator->pendingMigrations());

        $db = DB::connection('wgw');
        $inbox = $db->table('calendarinstances')
            ->where('principaluri', 'principals/admin')
            ->where('uri', InboxTaskListProvisioner::URI)
            ->value('calendarid');
        $this->assertNotNull($inbox, 'The update provisions the Tasks inbox.');
        $this->assertSame(
            $db->table('calendars')->count(),
            $db->table('calendar_collection_meta')->count(),
            'Every calendar has a collection kind after the backfill.',
        );
        $this->assertSame(1, $db->table('calendarobjects')->where('uid', 'upgrade-event')->count());
        $this->assertSame(1, $db->table('calendarobjects')->where('uid', 'upgrade-task')->count());

        $notebook = $db->table('calendarinstances')
            ->where('principaluri', 'principals/admin')
            ->where('uri', CalendarCollectionUris::NOTE_GENERAL)
            ->value('calendarid');
        $this->assertNotNull($notebook, 'The update provisions the default notebook.');
        $note = $db->table('calendarobjects')->where('uid', 'upgrade-note')->get();
        $this->assertCount(1, $note, 'The note survives the update.');
        $this->assertSame((int) $notebook, (int) $note[0]->calendarid, 'The note moves into the notebook.');
        $this->assertStringNotContainsString(
            'VJOURNAL',
            (string) $db->table('calendars')->where('id', $this->defaultCalendarId)->value('components'),
            'The default calendar no longer takes notes.',
        );
    }

    private function migrateAs0170(): void
    {
        $this->oldMigrations = sys_get_temp_dir().'/wgw-0170-migrations-'.uniqid('', true);
        File::ensureDirectoryExists($this->oldMigrations);
        foreach (File::files(database_path('migrations/wgw')) as $file) {
            if (strcmp($file->getBasename('.php'), self::LAST_IN_0_1_70) <= 0) {
                File::copy($file->getPathname(), $this->oldMigrations.'/'.$file->getFilename());
            }
        }

        $migrator = app('migrator');
        $migrator->setConnection('wgw');
        $migrator->getRepository()->createRepository();
        $migrator->run([$this->oldMigrations]);
        $this->assertCount(13, $migrator->getRepository()->getRan());
    }

    /**
     * What the 0.1.70 installer and a CalDAV client leave behind: a user with
     * a default calendar (VEVENT, VTODO and VJOURNAL, as 0.1.70 created it)
     * holding an event, a task and a note.
     */
    private function seed0170User(string $username): void
    {
        User::query()->create(['username' => $username, 'digesta1' => '', 'digest' => '']);
        Principal::query()->create(['uri' => 'principals/'.$username, 'displayname' => ucfirst($username)]);

        $caldav = new CalPDO(DB::connection('wgw')->getPdo());
        $calendarId = $caldav->createCalendar('principals/'.$username, 'default', [
            '{DAV:}displayname' => 'Calendar',
            '{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set' => new SupportedCalendarComponentSet(['VEVENT', 'VTODO', 'VJOURNAL']),
        ]);
        $this->defaultCalendarId = (int) $calendarId[0];
        $caldav->createCalendarObject($calendarId, 'upgrade-event.ics', $this->ics('VEVENT', 'upgrade-event'));
        $caldav->createCalendarObject($calendarId, 'upgrade-task.ics', $this->ics('VTODO', 'upgrade-task'));
        $caldav->createCalendarObject($calendarId, 'upgrade-note.ics', $this->ics('VJOURNAL', 'upgrade-note'));
    }

    private function ics(string $component, string $uid): string
    {
        $times = match ($component) {
            'VEVENT' => "DTSTART:20260710T090000Z\r\nDTEND:20260710T100000Z\r\n",
            'VJOURNAL' => "DTSTART:20260710T090000Z\r\nDESCRIPTION:Written before the update.\r\n",
            default => '',
        };

        return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//wgw//test//EN\r\n"
            ."BEGIN:{$component}\r\nUID:{$uid}\r\nDTSTAMP:20260701T090000Z\r\n{$times}SUMMARY:{$uid}\r\n"
            ."END:{$component}\r\nEND:VCALENDAR\r\n";
    }
}
