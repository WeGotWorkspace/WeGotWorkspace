<?php

declare(strict_types=1);

namespace Tests\Unit\Installer;

use App\Models\Principal;
use App\Models\User;
use App\Services\Installer\WgwSchemaMigrator;
use App\Services\Tasks\InboxTaskListProvisioner;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Sabre\CalDAV\Backend\PDO as CalPDO;
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
     * a default calendar holding an event and a VTODO.
     */
    private function seed0170User(string $username): void
    {
        User::query()->create(['username' => $username, 'digesta1' => '', 'digest' => '']);
        Principal::query()->create(['uri' => 'principals/'.$username, 'displayname' => ucfirst($username)]);

        $caldav = new CalPDO(DB::connection('wgw')->getPdo());
        $calendarId = $caldav->createCalendar('principals/'.$username, 'default', [
            '{DAV:}displayname' => 'Calendar',
        ]);
        $caldav->createCalendarObject($calendarId, 'upgrade-event.ics', $this->ics('VEVENT', 'upgrade-event'));
        $caldav->createCalendarObject($calendarId, 'upgrade-task.ics', $this->ics('VTODO', 'upgrade-task'));
    }

    private function ics(string $component, string $uid): string
    {
        $times = $component === 'VEVENT'
            ? "DTSTART:20260710T090000Z\r\nDTEND:20260710T100000Z\r\n"
            : '';

        return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//wgw//test//EN\r\n"
            ."BEGIN:{$component}\r\nUID:{$uid}\r\nDTSTAMP:20260701T090000Z\r\n{$times}SUMMARY:{$uid}\r\n"
            ."END:{$component}\r\nEND:VCALENDAR\r\n";
    }
}
