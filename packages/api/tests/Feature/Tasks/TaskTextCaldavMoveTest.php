<?php

declare(strict_types=1);

namespace Tests\Feature\Tasks;

use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use App\Models\TaskYjsState;
use App\Services\Collab\CollabExternalWrite;
use App\Services\Tasks\InboxTaskListProvisioner;
use Tests\Support\SendsFramedCollaboration;
use Tests\Support\TasksTestFixtures;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwInstallFixture;
use Tests\Support\WgwTestDisks;

/**
 * A CalDAV `MOVE` to another list drops the stored live-text state, as a REST
 * move does (#2208): the state can hold text deleted in the old list, which
 * the new list's audience must not recover.
 */
final class TaskTextCaldavMoveTest extends WgwDatabaseTestCase
{
    use SendsFramedCollaboration;
    use TasksTestFixtures;

    private const UID = 'caldav-move-uid';

    protected function setUp(): void
    {
        parent::setUp();

        $installRoot = sys_get_temp_dir().'/wgw-task-text-move-'.uniqid('', true);
        mkdir($installRoot, 0775, true);
        file_put_contents($installRoot.'/index.php', "<?php\n");
        $dataDir = $installRoot.'/wgw-content';
        mkdir($dataDir.'/files/users/bob', 0775, true);
        WgwInstallFixture::bindInstallRoot($installRoot, $dataDir);
        WgwInstallFixture::markInstalled($installRoot, $dataDir, 'admin');
        config(['wgw.install_root' => $installRoot, 'wgw.data_dir' => $dataDir]);
        WgwInstallFixture::forgetInstallBindings();
        WgwInstallFixture::purgeDatabaseConnection();
        WgwTestDisks::refresh($dataDir);

        $this->setUpTasksFixtures();
    }

    public function test_a_caldav_move_to_another_list_drops_the_stored_state(): void
    {
        $taskId = $this->seedTaskViaPdo('bob', 'moving.ics', $this->ics());
        $token = $this->issueBearerTokenFor('bob');
        $textUrl = '/api/v1/tasks/items/'.rawurlencode($taskId).'/text';
        $seen = (string) $this->withBearer($token)->getJson($textUrl)->assertOk()->headers->get('ETag');
        $this->withBearer($token)
            ->putCollaboration($textUrl, 'Typed', "\x01wiped from list A\x02", [
                'If-None-Match' => '*',
                CollabExternalWrite::HEADER => $seen,
            ], 'Plan')
            ->assertOk();
        $sourceId = (int) CalendarObject::query()->where('uri', 'moving.ics')->value('id');
        $this->assertSame(1, TaskYjsState::query()->where('calendar_object_id', $sourceId)->count());

        $this->withBearer($token)->postJson('/api/v1/tasks/tasklists', ['name' => 'Work'])->assertCreated();
        $this->flushHeaders();
        $workUri = (string) CalendarInstance::query()
            ->where('principaluri', 'principals/bob')
            ->where('displayname', 'Work')
            ->value('uri');
        $this->assertNotSame('', $workUri);

        $response = $this->call('MOVE', '/calendars/bob/'.InboxTaskListProvisioner::URI.'/moving.ics', [], [], [], [
            'HTTP_AUTHORIZATION' => 'Basic '.base64_encode('bob:secret'),
            'HTTP_DESTINATION' => 'http://localhost/calendars/bob/'.$workUri.'/moving.ics',
        ]);

        $this->assertContains($response->getStatusCode(), [201, 204], (string) $response->getContent());
        $moved = CalendarObject::query()->where('uri', 'moving.ics')->firstOrFail();
        $this->assertNotSame($sourceId, (int) $moved->id);
        $this->assertStringContainsString('Typed', (string) $moved->calendardata);
        $this->assertSame(0, TaskYjsState::query()->count());
    }

    private function ics(): string
    {
        return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//Reminders//EN\r\nBEGIN:VTODO\r\nUID:".self::UID."\r\n"
            ."DTSTAMP:20261118T000000Z\r\nSUMMARY:Plan\r\nDESCRIPTION:First notes\r\nSTATUS:NEEDS-ACTION\r\n"
            ."END:VTODO\r\nEND:VCALENDAR\r\n";
    }
}
