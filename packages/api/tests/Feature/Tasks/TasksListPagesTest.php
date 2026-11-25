<?php

declare(strict_types=1);

namespace Tests\Feature\Tasks;

use App\Services\Tasks\InboxTaskListProvisioner;
use Tests\Support\TasksTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/** `GET /tasks/items` in pages and with list fields only (#2361, Epic #2284). */
final class TasksListPagesTest extends WgwDatabaseTestCase
{
    use TasksTestFixtures;

    private const ENDPOINT = '/api/v1/tasks/items?taskListId='.InboxTaskListProvisioner::URI;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpTasksFixtures();
    }

    /** @return list<string> the ids in URI order */
    private function seedTasks(int $count): array
    {
        $ids = [];
        for ($i = 1; $i <= $count; $i++) {
            $ids[] = $this->seedTaskViaPdo('bob', sprintf('task-%03d.ics', $i), $this->sampleTodoIcs('Task '.$i));
        }

        return $ids;
    }

    public function test_pages_cover_the_list_once_in_uri_order(): void
    {
        $ids = $this->seedTasks(7);
        $seen = [];
        $cursor = null;
        $pages = 0;
        do {
            $url = self::ENDPOINT.'&limit=3'.($cursor !== null ? '&cursor='.urlencode($cursor) : '');
            $response = $this->withBearer($this->userBearerToken())->getJson($url)->assertOk();
            $pages++;
            foreach ($response->json('list') as $task) {
                $seen[] = $task['id'];
            }
            $cursor = $response->json('nextCursor');
        } while ($cursor !== null && $pages < 10);

        $this->assertSame(3, $pages);
        $this->assertSame($ids, $seen);
    }

    public function test_a_page_that_ends_exactly_at_the_list_has_no_cursor(): void
    {
        $this->seedTasks(4);

        $response = $this->withBearer($this->userBearerToken())->getJson(self::ENDPOINT.'&limit=4');

        $response->assertOk()->assertJsonCount(4, 'list')->assertJsonPath('nextCursor', null);
    }

    public function test_without_limit_the_whole_list_is_returned_without_a_cursor(): void
    {
        $this->seedTasks(5);

        $response = $this->withBearer($this->userBearerToken())->getJson(self::ENDPOINT)->assertOk();

        $this->assertCount(5, $response->json('list'));
        $this->assertArrayNotHasKey('nextCursor', $response->json());
    }

    public function test_list_fields_leave_out_the_heavy_parts(): void
    {
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//T//EN\r\nBEGIN:VTODO\r\nUID:lean-1\r\nSUMMARY:Lean task\r\n"
            ."DESCRIPTION:A long note\r\nPRIORITY:1\r\nDUE:20260615T090000Z\r\nATTENDEE;CN=Ann:mailto:ann@example.test\r\n"
            ."X-CUSTOM:kept for round trip\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:x\r\nTRIGGER:-PT15M\r\nEND:VALARM\r\n"
            ."END:VTODO\r\nEND:VCALENDAR\r\n";
        $id = $this->seedTaskViaPdo('bob', 'lean.ics', $ics);

        $full = $this->withBearer($this->userBearerToken())->getJson(self::ENDPOINT)->assertOk()->json('list.0');
        $lean = $this->withBearer($this->userBearerToken())->getJson(self::ENDPOINT.'&fields=list')->assertOk()->json('list.0');

        $this->assertSame($id, $lean['id']);
        $this->assertSame('Lean task', $lean['title']);
        $this->assertSame(1, $lean['priority']);
        $this->assertSame($full['due'], $lean['due']);
        $this->assertSame($full['etag'], $lean['etag']);
        foreach (['description', 'participants', 'alerts', 'icsProps'] as $heavy) {
            $this->assertArrayHasKey($heavy, $full, $heavy.' is in the full task');
            $this->assertArrayNotHasKey($heavy, $lean, $heavy.' must not be in a list row');
        }
        $this->assertSame('A long note', $full['description']);
    }

    public function test_limit_and_fields_are_validated(): void
    {
        $this->withBearer($this->userBearerToken())->getJson(self::ENDPOINT.'&limit=0')->assertStatus(400);
        $this->withBearer($this->userBearerToken())->getJson(self::ENDPOINT.'&limit=501')->assertStatus(400);
        $this->withBearer($this->userBearerToken())->getJson(self::ENDPOINT.'&fields=everything')->assertStatus(400);
    }
}
