<?php

declare(strict_types=1);

namespace Tests\Feature\Tasks;

use App\Models\CalendarObject;
use Tests\Support\OptimisticConcurrencyTestHelpers;
use Tests\Support\TasksTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Assignees next to what native clients write (#2172, chunk E).
 *
 * - A Thunderbird-shaped VTODO with ORGANIZER and two ATTENDEEs reads as `org`
 *   plus `u:`/`e:` ids, and an assign from the web app leaves those lines as
 *   Thunderbird wrote them. The fixture is hand-written in Thunderbird 158's
 *   shape (see its README), not a capture.
 * - On the real Apple Reminders capture, an assign from the web app adds one
 *   ATTENDEE and the assigner as ORGANIZER, and keeps everything Reminders wrote.
 */
final class TaskAssigneesInteropTest extends WgwDatabaseTestCase
{
    use OptimisticConcurrencyTestHelpers;
    use TasksTestFixtures;

    private const THUNDERBIRD = __DIR__.'/../../fixtures/Interop/Assignees/thunderbird-shaped-todo.ics';

    private const REMINDERS = __DIR__.'/../../fixtures/Interop/RealClients/apple-reminders-macos26-todo.before.ics';

    private string $listId;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpTasksFixtures();
        $this->seedInboxTaskListFor('alice');
        $this->seedSharedTeam('crew', 'bob', 'alice', 'carol');

        $this->listId = (string) $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/tasks/tasklists', ['name' => 'Office'])
            ->assertCreated()
            ->json('id');
        $this->withBearer($this->userBearerToken())->patchJson('/api/v1/tasks/tasklists/'.$this->listId, ['shareWith' => [
            'alice' => ['mayWriteAll' => true],
            'carol' => ['mayWriteAll' => true],
        ]])->assertOk();
    }

    public function test_thunderbird_attendees_read_as_stable_ids_and_survive_an_assign(): void
    {
        $original = $this->fixture(self::THUNDERBIRD);
        $taskId = $this->seedTaskViaPdo('bob', 'tb-desks.ics', $original, $this->listId);
        $url = '/api/v1/tasks/items/'.rawurlencode($taskId);

        $task = $this->withBearer($this->userBearerToken())->getJson($url)->assertOk()->json();
        $this->assertSame(['org', 'u:alice', 'e:guest@outside.test'], array_keys($task['participants']));
        $this->assertSame(['owner'], $task['participants']['org']['roles']);
        $this->assertSame('alice', $task['participants']['u:alice']['username']);
        $this->assertNull($task['participants']['e:guest@outside.test']['username']);

        $this->withBearer($this->userBearerToken())->patchJson($url, ['participants' => [
            'u:carol' => ['@type' => 'Participant', 'roles' => ['attendee']],
        ]], $this->withIfMatch((string) $task['etag']))->assertOk();

        $stored = $this->stored('tb-desks.ics');
        foreach ([
            'ORGANIZER;CN=Bob:mailto:bob@example.test',
            'ATTENDEE;RSVP=TRUE;CN=Alice;PARTSTAT=NEEDS-ACTION;ROLE=REQ-PARTICIPANT:mailto:alice@example.test',
            'ATTENDEE;RSVP=TRUE;CN=Guest Supplier;PARTSTAT=NEEDS-ACTION;ROLE=OPT-PARTICIPANT:mailto:guest@outside.test',
            'X-MOZ-GENERATION:2',
            'PRODID:-//Mozilla.org/NONSGML Mozilla Calendar V1.1//EN',
        ] as $line) {
            $this->assertStringContainsString($line."\r\n", $stored, $line);
        }
        $this->assertStringContainsString('X-WGW-USERNAME=carol', $stored);
        $this->assertSame(3, substr_count($stored, "\r\nATTENDEE"));

        $after = $this->withBearer($this->userBearerToken())->getJson($url)->assertOk()->json('participants');
        $this->assertSame(['org', 'u:alice', 'e:guest@outside.test', 'u:carol'], array_keys($after));
    }

    public function test_reminders_capture_keeps_its_properties_when_the_web_app_assigns(): void
    {
        $objectUri = '7D77CEB3-3D5D-47A8-B7B6-D8E66232CAA1.ics';
        $taskId = $this->seedTaskViaPdo('bob', $objectUri, $this->fixture(self::REMINDERS), $this->listId);
        $url = '/api/v1/tasks/items/'.rawurlencode($taskId);
        $etag = (string) $this->withBearer($this->userBearerToken())->getJson($url)->assertOk()->json('etag');

        $this->withBearer($this->userBearerToken())->patchJson($url, ['participants' => [
            'u:alice' => ['@type' => 'Participant', 'roles' => ['attendee']],
        ]], $this->withIfMatch($etag))->assertOk();

        $stored = $this->stored($objectUri);
        $this->assertStringContainsString("PRODID:-//Apple Inc.//iOS 26.6.2//EN\r\n", $stored);
        $this->assertStringContainsString("X-WR-ALARMUID:FA244C6F-4678-4FF4-82AE-11E608EA9EB0\r\n", $stored);
        $this->assertSame(1, substr_count($stored, 'BEGIN:VTIMEZONE'));
        $this->assertSame(1, substr_count($stored, "\r\nATTENDEE"));
        $this->assertStringContainsString('X-WGW-USERNAME=alice', $stored);
        // The capture has no organizer, so the first assignment makes bob, who assigned, the organizer.
        $this->assertSame(1, substr_count($stored, "\r\nORGANIZER"));
        $this->assertMatchesRegularExpression('/\r\nORGANIZER;[^\r]*:mailto:bob@example\.test\r\n/', $stored);
    }

    public function test_a_username_claim_that_contradicts_the_address_and_name_reads_as_the_named_account(): void
    {
        // A CalDAV client writes alice's account with carol's name and address.
        $taskId = $this->seedTaskViaPdo('bob', 'spoof.ics', "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n"
            ."BEGIN:VTODO\r\nUID:spoof-1\r\nDTSTAMP:20260101T000000Z\r\nSUMMARY:Spoof\r\n"
            ."ATTENDEE;X-WGW-USERNAME=alice;CN=Carol:mailto:carol@example.test\r\n"
            ."END:VTODO\r\nEND:VCALENDAR\r\n", $this->listId);

        $participants = $this->withBearer($this->issueBearerTokenFor('carol'))
            ->getJson('/api/v1/tasks/items/'.rawurlencode($taskId))
            ->assertOk()
            ->json('participants');

        // One person, shown as who the account is: never as carol.
        $this->assertSame(['u:alice'], array_keys($participants));
        $this->assertSame('Alice', $participants['u:alice']['name']);
        $this->assertSame('alice@example.test', $participants['u:alice']['email']);
    }

    private function fixture(string $path): string
    {
        $ics = file_get_contents($path);
        $this->assertIsString($ics);

        return $ics;
    }

    private function stored(string $objectUri): string
    {
        $raw = (string) CalendarObject::query()->where('uri', $objectUri)->firstOrFail()->calendardata;

        return str_replace("\r\n ", '', $raw);
    }
}
