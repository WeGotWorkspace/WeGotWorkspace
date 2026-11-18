<?php

declare(strict_types=1);

namespace Tests\Feature\Tasks;

use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use App\Models\Notification;
use App\Services\Notify\TaskAssignedNotify;
use App\Services\Notify\TaskAssignedRateLimiter;
use Illuminate\Testing\TestResponse;
use Tests\Support\TasksTestFixtures;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwInstallFixture;
use Tests\Support\WgwTestDisks;

/**
 * The CalDAV side of the task change set (#2172): a native client that adds an
 * ATTENDEE notifies that person like the web app does.
 *
 * bob owns "Groceries", shared with alice (write) and carol (read). All three
 * share Team "crew". It also pins that a CalDAV PUT keeps the stored ORGANIZER.
 */
final class TaskChangeObserverPluginTest extends WgwDatabaseTestCase
{
    use TasksTestFixtures;

    private string $bobListUri;

    protected function setUp(): void
    {
        parent::setUp();
        // CalDAV answers 503 until the install is marked done.
        $installRoot = sys_get_temp_dir().'/wgw-task-observer-'.uniqid('', true);
        mkdir($installRoot, 0775, true);
        file_put_contents($installRoot.'/index.php', "<?php\n");
        $dataDir = $installRoot.'/wgw-content';
        mkdir($dataDir, 0775, true);
        WgwInstallFixture::bindInstallRoot($installRoot, $dataDir);
        WgwInstallFixture::markInstalled($installRoot, $dataDir, 'admin');
        config(['wgw.install_root' => $installRoot, 'wgw.data_dir' => $dataDir]);
        WgwInstallFixture::forgetInstallBindings();
        WgwInstallFixture::purgeDatabaseConnection();
        WgwTestDisks::refresh($dataDir);
        $this->setUpTasksFixtures();
        $this->seedInboxTaskListFor('alice');
        $this->seedSharedTeam('crew', 'bob', 'alice', 'carol');

        $listId = (string) $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/tasks/tasklists', ['name' => 'Groceries'])
            ->assertCreated()
            ->json('id');
        $this->withBearer($this->userBearerToken())->patchJson('/api/v1/tasks/tasklists/'.$listId, ['shareWith' => [
            'alice' => ['mayWriteAll' => true],
            'carol' => ['mayWriteAll' => false],
        ]])->assertOk();
        $this->bobListUri = $this->listUriOf('bob');
    }

    public function test_caldav_put_that_adds_an_attendee_notifies_them_once(): void
    {
        $this->davPut('bob', $this->bobListUri, 'milk.ics', $this->vtodo('milk-1', []))->assertCreated();
        $this->assertSame(0, $this->assignedCount());

        $this->davPut('bob', $this->bobListUri, 'milk.ics', $this->vtodo('milk-1', ['alice@example.test']))->assertNoContent();
        $this->davPut('bob', $this->bobListUri, 'milk.ics', $this->vtodo('milk-1', ['alice@example.test'], 'Buy milk now'))->assertNoContent();

        $rows = Notification::query()->where('action', TaskAssignedNotify::ACTION)->get();
        $this->assertCount(1, $rows);
        $this->assertSame('alice', $rows->first()?->principal);
        $this->assertSame('Bob assigned you Buy milk', $rows->first()?->title);
    }

    public function test_a_caldav_put_cannot_replace_or_drop_the_organizer(): void
    {
        // bob's client stores the task with himself as organizer and alice as attendee.
        $this->davPut('bob', $this->bobListUri, 'org.ics', $this->organised('ORGANIZER;CN=Bob:mailto:bob@example.test'))->assertCreated();

        // alice's client (Thunderbird-shaped) claims the task, then drops the line.
        $aliceUri = $this->listUriOf('alice');
        $this->davPut('alice', $aliceUri, 'org.ics', $this->organised('ORGANIZER;CN=Alice:mailto:alice@example.test'))->assertNoContent();
        $this->assertStringContainsString("ORGANIZER;CN=Bob:mailto:bob@example.test\r\n", $this->storedObject('org.ics'));
        $this->davPut('alice', $aliceUri, 'org.ics', $this->organised(''))->assertNoContent();

        $stored = $this->storedObject('org.ics');
        $this->assertSame(1, substr_count($stored, 'ORGANIZER'));
        $this->assertStringContainsString("ORGANIZER;CN=Bob:mailto:bob@example.test\r\n", $stored);
        $this->assertStringContainsString('SUMMARY:Edited by alice', $stored);
    }

    public function test_a_new_file_with_an_attendee_notifies_them(): void
    {
        $this->davPut('alice', $this->listUriOf('alice'), 'rent.ics', $this->vtodo('rent-1', ['bob@example.test'], 'Pay rent'))
            ->assertCreated();

        $this->assertSame(['bob'], Notification::query()->where('action', TaskAssignedNotify::ACTION)->pluck('principal')->all());
    }

    public function test_reader_and_unknown_attendees_are_stored_but_not_notified(): void
    {
        $this->davPut('bob', $this->bobListUri, 'milk.ics', $this->vtodo('milk-1', ['carol@example.test', 'guest@outside.test']))
            ->assertCreated();

        $this->assertSame(0, $this->assignedCount());
    }

    public function test_a_recurring_task_with_an_override_notifies_once(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\n"
            ."BEGIN:VTODO\r\nUID:weekly-1\r\nDTSTAMP:20261118T120000Z\r\nSUMMARY:Bins out\r\n"
            ."DTSTART:20261119T080000Z\r\nDUE:20261119T090000Z\r\nRRULE:FREQ=WEEKLY\r\n"
            ."ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:alice@example.test\r\nEND:VTODO\r\n"
            ."BEGIN:VTODO\r\nUID:weekly-1\r\nDTSTAMP:20261118T120000Z\r\nRECURRENCE-ID:20261126T080000Z\r\n"
            ."SUMMARY:Bins out (late)\r\nDTSTART:20261126T100000Z\r\nDUE:20261126T110000Z\r\n"
            ."ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:alice@example.test\r\nEND:VTODO\r\n"
            ."END:VCALENDAR\r\n";

        $this->davPut('bob', $this->bobListUri, 'bins.ics', $ics)->assertCreated();

        $this->assertSame(['alice'], Notification::query()->where('action', TaskAssignedNotify::ACTION)->pluck('principal')->all());
    }

    public function test_forbidden_caldav_put_on_read_only_list_notifies_nobody(): void
    {
        $this->davPut('carol', $this->listUriOf('carol'), 'sneaky.ics', $this->vtodo('sneaky-1', ['alice@example.test']))
            ->assertForbidden();

        $this->assertSame(0, $this->assignedCount());
    }

    public function test_delete_notifies_nobody(): void
    {
        $this->davPut('bob', $this->bobListUri, 'milk.ics', $this->vtodo('milk-1', []))->assertCreated();

        $this->dav('bob', 'DELETE', $this->bobListUri, 'milk.ics')->assertNoContent();

        $this->assertSame(0, $this->assignedCount());
    }

    public function test_observer_exception_does_not_fail_the_put(): void
    {
        $this->app->bind(TaskAssignedRateLimiter::class, static fn () => throw new \RuntimeException('limiter down'));

        $this->davPut('bob', $this->bobListUri, 'milk.ics', $this->vtodo('milk-1', ['alice@example.test']))->assertCreated();

        $this->assertSame(0, $this->assignedCount());
    }

    private function assignedCount(): int
    {
        return Notification::query()->where('action', TaskAssignedNotify::ACTION)->count();
    }

    private function listUriOf(string $username): string
    {
        $instance = CalendarInstance::query()
            ->where('principaluri', 'principals/'.$username)
            ->where('displayname', 'Groceries')
            ->firstOrFail();

        return (string) $instance->uri;
    }

    private function organised(string $organizerLine): string
    {
        $summary = $organizerLine === '' || str_contains($organizerLine, 'alice') ? 'Edited by alice' : 'Buy milk';

        return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Mozilla.org/NONSGML Mozilla Calendar V1.1//EN\r\n"
            ."BEGIN:VTODO\r\nUID:org-1\r\nDTSTAMP:20261118T120000Z\r\nSUMMARY:{$summary}\r\n"
            .($organizerLine === '' ? '' : $organizerLine."\r\n")
            ."ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:alice@example.test\r\n"
            ."END:VTODO\r\nEND:VCALENDAR\r\n";
    }

    private function storedObject(string $objectUri): string
    {
        $raw = (string) CalendarObject::query()->where('uri', $objectUri)->firstOrFail()->calendardata;

        return str_replace("\r\n ", '', $raw);
    }

    /**
     * @param  list<string>  $attendees
     */
    private function vtodo(string $uid, array $attendees, string $summary = 'Buy milk'): string
    {
        return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\n"
            .$this->vtodoBlock($uid, $attendees, $summary)
            ."END:VCALENDAR\r\n";
    }

    /**
     * @param  list<string>  $attendees
     */
    private function vtodoBlock(string $uid, array $attendees, string $summary): string
    {
        $block = "BEGIN:VTODO\r\nUID:{$uid}\r\nDTSTAMP:20261118T120000Z\r\nSUMMARY:{$summary}\r\n";
        foreach ($attendees as $email) {
            $block .= "ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:{$email}\r\n";
        }

        return $block."END:VTODO\r\n";
    }

    private function davPut(string $username, string $listUri, string $objectUri, string $ics): TestResponse
    {
        return $this->dav($username, 'PUT', $listUri, $objectUri, $ics);
    }

    private function dav(string $username, string $method, string $listUri, string $objectUri, string $body = ''): TestResponse
    {
        return $this->call(
            $method,
            "/calendars/{$username}/{$listUri}/{$objectUri}",
            [],
            [],
            [],
            [
                'HTTP_AUTHORIZATION' => 'Basic '.base64_encode($username.':secret'),
                'CONTENT_TYPE' => 'text/calendar',
                'CONTENT_LENGTH' => (string) strlen($body),
            ],
            $body,
        );
    }
}
