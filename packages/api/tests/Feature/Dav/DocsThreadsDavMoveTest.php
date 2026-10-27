<?php

declare(strict_types=1);

namespace Tests\Feature\Dav;

use App\Models\CalendarObject;
use App\Models\DocsThreadIndex;
use App\Models\Principal;
use App\Services\Admin\AdminConstants;
use App\Services\Docs\DocsThreadCollectionUris;
use App\Services\Docs\DocsThreadPoolProvisioner;
use App\Services\Drive\DriveService;
use App\Support\WgwSettings;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwInstallFixture;
use Tests\Support\WgwTestDisks;

/**
 * Docs comment threads are keyed by doc path. A move must take them along on
 * every write surface, and a delete must drop them, or a file created later at
 * the old path inherits them (#1612).
 */
final class DocsThreadsDavMoveTest extends WgwDatabaseTestCase
{
    private const FROM = '/users/bob/docs/plan.md';

    private const TO = '/users/bob/docs/renamed.md';

    private const GROUP_TO = '/groups/team/plan.md';

    private const THREAD = '01J6Y6M0R2V9GKJ4W1T8Q3ZBAA';

    private const OTHER_THREAD = '01J6Y6M0R2V9GKJ4W1T8Q3ZBAB';

    private const REPLY = '01J6Y6M0R2V9GKJ4W1T8Q3ZBAC';

    private string $dataDir = '';

    protected function setUp(): void
    {
        parent::setUp();

        putenv('WGW_DISABLE_LOGIN_THROTTLE=1');
        $_ENV['WGW_DISABLE_LOGIN_THROTTLE'] = '1';
        $this->configureWgwJwtKeys();

        $installRoot = sys_get_temp_dir().'/wgw-threads-move-'.uniqid('', true);
        mkdir($installRoot, 0775, true);
        file_put_contents($installRoot.'/index.php', "<?php\n");
        $this->dataDir = $installRoot.'/wgw-content';
        mkdir($this->dataDir.'/files/users/bob/docs', 0775, true);
        WgwInstallFixture::bindInstallRoot($installRoot, $this->dataDir);
        WgwInstallFixture::markInstalled($installRoot, $this->dataDir, 'bob');

        config(['wgw.install_root' => $installRoot, 'wgw.data_dir' => $this->dataDir]);
        WgwInstallFixture::forgetInstallBindings();
        WgwInstallFixture::purgeDatabaseConnection();
        $this->configureWgwJwtKeys();
        $this->setAppSetting(WgwSettings::BROWSER_PLUGIN, false);
        WgwTestDisks::refresh($this->dataDir);

        $this->putDoc(self::FROM, "# Plan\n\nInitial");
    }

    public function test_rest_rename_moves_threads(): void
    {
        $this->createThread(self::FROM);

        app(DriveService::class)->renameItem($this->bob(), '/users/bob/docs', 'plan.md', 'renamed.md');

        $this->assertThreadIds(self::TO, [self::THREAD]);
        $this->assertThreadIds(self::FROM, []);
    }

    public function test_webdav_move_moves_threads(): void
    {
        $this->createThread(self::FROM);

        $this->move(self::FROM, self::TO)->assertSuccessful();

        $this->assertThreadIds(self::TO, [self::THREAD], 'thread should follow the doc to its new path');
        $this->assertThreadIds(self::FROM, [], 'thread should not stay on the old path');
    }

    public function test_webdav_move_of_a_folder_moves_the_threads_of_its_documents(): void
    {
        $this->createThread(self::FROM);
        $this->reply(self::FROM, self::THREAD, self::REPLY);

        $this->move('/users/bob/docs', '/users/bob/archive')->assertSuccessful();

        $threads = $this->assertThreadIds('/users/bob/archive/plan.md', [self::THREAD]);
        $this->assertCount(2, $threads[0]['messages'], 'the reply should move with its thread');
        $this->putDoc(self::FROM, "# A different doc\n");
        $this->assertThreadIds(self::FROM, []);
    }

    public function test_webdav_delete_drops_threads_so_a_new_file_starts_clean(): void
    {
        $this->createThread(self::FROM);

        $this->dav('DELETE', self::FROM)->assertSuccessful();
        $this->putDoc(self::FROM, "# A different doc\n");

        $this->assertThreadIds(self::FROM, [], 'a new file at the old path inherited the old threads');
        $this->assertSame(0, CalendarObject::query()->where('uid', self::THREAD)->count());
    }

    public function test_webdav_move_overwriting_a_document_keeps_only_the_moved_threads(): void
    {
        $this->putDoc(self::TO, "# Renamed\n");
        $this->createThread(self::FROM, self::THREAD);
        $this->createThread(self::TO, self::OTHER_THREAD);

        // Sabre deletes the overwritten target itself, without an afterMethod:DELETE.
        $this->move(self::FROM, self::TO, ['HTTP_OVERWRITE' => 'T'])->assertSuccessful();

        $this->assertThreadIds(self::TO, [self::THREAD]);
        $this->assertThreadIds(self::FROM, []);
        $this->assertSame(0, CalendarObject::query()->where('uid', self::OTHER_THREAD)->count());
        $this->assertSame(0, DocsThreadIndex::query()->where('uid', self::OTHER_THREAD)->count());
    }

    public function test_office_save_swap_keeps_threads_on_the_document(): void
    {
        $this->createThread(self::FROM);

        $this->move(self::FROM, '/users/bob/docs/~WRL0001.tmp')->assertSuccessful();
        $this->putDoc('/users/bob/docs/~WRD0000.tmp', "# Plan\n\nSaved");
        $this->move('/users/bob/docs/~WRD0000.tmp', self::FROM)->assertSuccessful();
        $this->dav('DELETE', '/users/bob/docs/~WRL0001.tmp')->assertSuccessful();

        $this->assertThreadIds(self::FROM, [self::THREAD]);
    }

    public function test_editor_save_over_the_document_keeps_its_threads(): void
    {
        $this->createThread(self::FROM);
        $this->putDoc('/users/bob/docs/plan.md.tmp', "# Plan\n\nSaved");

        $this->move('/users/bob/docs/plan.md.tmp', self::FROM, ['HTTP_OVERWRITE' => 'T'])->assertSuccessful();

        $this->assertThreadIds(self::FROM, [self::THREAD]);
    }

    public function test_rest_move_into_a_group_folder_moves_threads_into_the_group_pool(): void
    {
        $this->seedTeamWithBob();
        $this->createThread(self::FROM);
        $this->reply(self::FROM, self::THREAD, self::REPLY);

        app(DriveService::class)->renameItem($this->bob(), '/groups/team', self::FROM, 'plan.md');

        $this->assertThreadIds(self::FROM, []);
        $this->assertMovedIntoPool(self::GROUP_TO);
    }

    public function test_webdav_refuses_a_move_from_a_personal_into_a_group_folder_and_keeps_threads(): void
    {
        // WebdavWriteGuardPlugin keeps DAV moves inside users/ or inside groups/.
        $this->seedTeamWithBob();
        $this->createThread(self::FROM);

        $this->move(self::FROM, self::GROUP_TO)->assertForbidden();

        $this->assertThreadIds(self::FROM, [self::THREAD]);
    }

    public function test_webdav_move_into_another_group_folder_moves_threads_into_that_group_pool(): void
    {
        $this->seedTeamWithBob();
        $ops = $this->seedWgwGroup('principals/groups/ops', 'Ops');
        $bob = Principal::forUsername('bob');
        $this->assertNotNull($bob);
        $this->addPrincipalToGroup($ops, $bob);
        mkdir($this->dataDir.'/files/groups/ops', 0775, true);
        $this->putDoc(self::GROUP_TO, "# Plan\n");
        $this->createThread(self::GROUP_TO);
        $this->reply(self::GROUP_TO, self::THREAD, self::REPLY);

        $this->move(self::GROUP_TO, '/groups/ops/plan.md')->assertSuccessful();

        $this->assertThreadIds(self::GROUP_TO, []);
        $this->assertMovedIntoPool('/groups/ops/plan.md');
    }

    public function test_thread_bookkeeping_failure_never_fails_the_move_or_delete(): void
    {
        $this->createThread(self::FROM);
        // Every docs_thread_index query fails from here on. No DDL: on MySQL a
        // DROP TABLE commits the test transaction and leaks into later tests.
        DB::connection('wgw')->listen(static function (QueryExecuted $query): void {
            if (str_contains($query->sql, 'docs_thread_index')) {
                throw new \RuntimeException('docs_thread_index unavailable');
            }
        });
        /** @var list<MessageLogged> $logged */
        $logged = [];
        Log::listen(function (MessageLogged $event) use (&$logged): void {
            $logged[] = $event;
        });

        $this->move(self::FROM, self::TO)->assertStatus(201);
        app(DriveService::class)->renameItem($this->bob(), '/users/bob/docs', 'renamed.md', 'again.md');
        $this->dav('DELETE', '/users/bob/docs/again.md')->assertNoContent();

        $this->assertFalse(Storage::disk('wgw_files')->exists('users/bob/docs/again.md'));
        $failures = array_filter(
            $logged,
            static fn (MessageLogged $event): bool => $event->message === 'docs_thread_path_sync_failed',
        );
        $this->assertCount(3, $failures);
    }

    private function seedTeamWithBob(): void
    {
        Principal::query()->firstOrCreate(
            ['uri' => AdminConstants::GROUP_CONTAINER_URI],
            ['displayname' => 'Groups', 'email' => null],
        );
        $team = $this->seedWgwGroup('principals/groups/team', 'Team');
        $bob = Principal::forUsername('bob');
        $this->assertNotNull($bob);
        $this->addPrincipalToGroup($team, $bob);
        mkdir($this->dataDir.'/files/groups/team', 0775, true);
    }

    /**
     * The thread and its reply are listed at $path and live only in the pool
     * of $path's owner, with docs_thread_index pointing at that pool.
     */
    private function assertMovedIntoPool(string $path): void
    {
        $threads = $this->assertThreadIds($path, [self::THREAD]);
        $this->assertCount(2, $threads[0]['messages']);

        $pool = app(DocsThreadPoolProvisioner::class)->findPool(DocsThreadCollectionUris::ownerPrincipalUri($path));
        $this->assertNotNull($pool);
        foreach ([self::THREAD, self::REPLY] as $uid) {
            $calendarIds = CalendarObject::query()->where('uid', $uid)->pluck('calendarid')->all();
            $this->assertSame([(int) $pool->calendarid], array_map('intval', $calendarIds));
            $this->assertSame((int) $pool->calendarid, (int) DocsThreadIndex::query()->where('uid', $uid)->value('calendarid'));
        }
    }

    private function createThread(string $path, string $id = self::THREAD): void
    {
        $this->asBob()->postJson('/api/v1/files/threads?path='.urlencode($path), [
            'id' => $id,
            'kind' => 'comment',
            'body' => 'please clarify',
            'anchorText' => 'Plan',
            'anchorFrom' => 0,
            'anchorTo' => 4,
            'anchorOccurrence' => 0,
        ])->assertCreated();
    }

    private function reply(string $path, string $threadId, string $id): void
    {
        $this->asBob()->postJson('/api/v1/files/threads/'.$threadId.'/replies?path='.urlencode($path), [
            'id' => $id,
            'body' => 'working on it',
        ])->assertOk();
    }

    /**
     * @param  list<string>  $expected
     * @return list<array<string, mixed>>
     */
    private function assertThreadIds(string $path, array $expected, string $message = ''): array
    {
        /** @var list<array<string, mixed>> $list */
        $list = $this->asBob()
            ->getJson('/api/v1/files/threads?path='.urlencode($path))
            ->assertOk()
            ->json('list');
        $this->assertSame($expected, array_map(static fn (array $thread): string => (string) $thread['id'], $list), $message);

        return $list;
    }

    private function asBob(): self
    {
        return $this->withBearer($this->issueBearerTokenFor('bob'));
    }

    /** @return array{username: string, role: string} */
    private function bob(): array
    {
        return ['username' => 'bob', 'role' => 'user'];
    }

    private function putDoc(string $path, string $content): void
    {
        Storage::disk('wgw_files')->put(ltrim($path, '/'), $content);
    }

    /**
     * @param  array<string, string>  $server
     */
    private function move(string $from, string $to, array $server = []): TestResponse
    {
        return $this->dav('MOVE', $from, ['HTTP_DESTINATION' => '/files'.$to, ...$server]);
    }

    /**
     * @param  array<string, string>  $server
     */
    private function dav(string $method, string $path, array $server = []): TestResponse
    {
        return $this->call($method, '/files'.$path, [], [], [], [
            'HTTP_AUTHORIZATION' => 'Basic '.base64_encode('bob:secret'),
            ...$server,
        ]);
    }
}
