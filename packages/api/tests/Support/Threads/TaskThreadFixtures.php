<?php

declare(strict_types=1);

namespace Tests\Support\Threads;

use App\Models\CalendarInstance;
use App\Models\ThreadIndex;
use Illuminate\Testing\TestResponse;
use Tests\Support\TasksTestFixtures;
use Tests\Support\WgwInstallFixture;
use Tests\Support\WgwTestDisks;

/**
 * Task threads (#2173): bob owns "Groceries", shared with alice (write) and
 * carol (read); crew = bob, alice, carol. dave sees nothing. CalDAV works,
 * because the install is marked done.
 */
trait TaskThreadFixtures
{
    use TasksTestFixtures;

    private const ULID_PREFIX = '01J6Y6M0R2V9GKJ4W1T8Q3';

    private int $ulidCounter = 0;

    /** @var array<string, string> */
    private array $tokens = [];

    protected function setUpTaskThreads(): void
    {
        $installRoot = sys_get_temp_dir().'/wgw-task-threads-'.uniqid('', true);
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
        $this->seedWgwUser('dave', displayName: 'Dave');
        foreach (['alice', 'dave'] as $username) {
            $this->seedInboxTaskListFor($username);
        }
        $this->seedSharedTeam('crew', 'bob', 'alice', 'carol');
        $this->appointTeamAdmin('crew', 'bob');
    }

    /** bob's "Groceries", shared with alice (write) and carol (read). Returns bob's list id. */
    protected function groceries(): string
    {
        $listId = $this->createList('bob', 'Groceries');
        $this->asUser('bob')->patchJson('/api/v1/tasks/tasklists/'.$listId, ['shareWith' => [
            'alice' => ['mayWriteAll' => true],
            'carol' => ['mayWriteAll' => false],
        ]])->assertOk();

        return $listId;
    }

    protected function createList(string $username, string $name): string
    {
        return (string) $this->asUser($username)
            ->postJson('/api/v1/tasks/tasklists', ['name' => $name])
            ->assertCreated()
            ->json('id');
    }

    protected function createTask(string $username, string $listId, string $title): string
    {
        return (string) $this->asUser($username)
            ->postJson('/api/v1/tasks/items', ['title' => $title, 'taskListIds' => [$listId => true]])
            ->assertCreated()
            ->json('id');
    }

    /** Move a task through the REST API (PUT with another list), as the web app does. */
    protected function moveTask(string $username, string $taskId, string $targetListId, string $title = 'Milk'): TestResponse
    {
        $etag = $this->asUser($username)->getJson('/api/v1/tasks/items/'.$taskId)->assertOk()->headers->get('ETag');

        return $this->asUser($username)
            ->withHeader('If-Match', (string) $etag)
            ->putJson('/api/v1/tasks/items/'.$taskId, ['title' => $title, 'taskListIds' => [$targetListId => true]]);
    }

    /** The list id $username sees for the list named $name. */
    protected function listIdFor(string $username, string $name): string
    {
        foreach ((array) $this->asUser($username)->getJson('/api/v1/tasks/tasklists')->assertOk()->json('list') as $list) {
            if (($list['name'] ?? null) === $name) {
                return (string) $list['id'];
            }
        }
        $this->fail("{$username} does not see {$name}");
    }

    protected function listUriOf(string $username, string $name): string
    {
        return (string) CalendarInstance::query()
            ->where('principaluri', 'principals/'.$username)
            ->where('displayname', $name)
            ->firstOrFail()
            ->uri;
    }

    protected function ulid(): string
    {
        // Crockford base 32 has no I, L, O or U, which a ULID refuses.
        $digits = strtr(strtoupper(base_convert((string) ++$this->ulidCounter, 10, 32)), '0123456789ABCDEFGHIJKLMNOPQRSTUV', '0123456789ABCDEFGHJKMNPQRSTVWXYZ');

        return self::ULID_PREFIX.str_pad($digits, 4, '0', STR_PAD_LEFT);
    }

    /**
     * @param  array<string, mixed>  $extra
     */
    protected function comment(string $username, string $taskId, string $body, array $extra = []): TestResponse
    {
        return $this->asUser($username)->postJson($this->threadUrl($taskId, 'entries'), ['id' => $extra['id'] ?? $this->ulid(), 'body' => $body, ...$extra]);
    }

    /**
     * @return list<array<string, mixed>>
     */
    protected function entries(string $username, string $taskId): array
    {
        return (array) $this->asUser($username)->getJson($this->threadUrl($taskId, 'entries'))->assertOk()->json('list');
    }

    protected function threadUrl(string $taskId, string $suffix, string $type = 'task'): string
    {
        return '/api/v1/threads/'.$type.'/'.rawurlencode($taskId).'/'.$suffix;
    }

    protected function entryCount(): int
    {
        return ThreadIndex::query()->count();
    }

    protected function dav(string $username, string $method, string $path, string $body = '', array $headers = []): TestResponse
    {
        return $this->call($method, '/calendars/'.$username.'/'.$path, [], [], [], [
            'HTTP_AUTHORIZATION' => 'Basic '.base64_encode($username.':secret'),
            'CONTENT_TYPE' => 'text/calendar',
            'CONTENT_LENGTH' => (string) strlen($body),
            ...$headers,
        ], $body);
    }

    protected function vtodo(string $uid, string $summary): string
    {
        return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\nBEGIN:VTODO\r\nUID:{$uid}\r\nDTSTAMP:20261118T120000Z\r\nSUMMARY:{$summary}\r\nEND:VTODO\r\nEND:VCALENDAR\r\n";
    }

    protected function asUser(string $username): static
    {
        $this->tokens[$username] ??= $this->issueBearerTokenFor($username);

        return $this->withBearer($this->tokens[$username]);
    }
}
