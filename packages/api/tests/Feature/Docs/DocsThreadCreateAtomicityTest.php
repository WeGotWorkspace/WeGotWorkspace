<?php

declare(strict_types=1);

namespace Tests\Feature\Docs;

use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use App\Models\DocsThreadIndex;
use App\Services\Docs\DocsThreadCollectionUris;
use App\Services\Docs\DocsThreadPoolProvisioner;
use App\Services\Docs\DocsThreadRepository;
use App\Storage\WgwStorage;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Exceptions;
use Illuminate\Support\Facades\Schema;
use Illuminate\Testing\TestResponse;
use Tests\Support\DocsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Creating a thread or a reply is all or nothing: the UID checks, the VJOURNAL
 * and its docs_thread_index row commit together (#1611).
 *
 * A real race needs two connections. These tests build the state the losing
 * request used to see between its check and its insert, then send it.
 */
final class DocsThreadCreateAtomicityTest extends WgwDatabaseTestCase
{
    use DocsTestFixtures;

    private const PATH = '/users/bob/docs/plan.md';

    private const GROUP_PATH = '/groups/team/plan.md';

    private const THREAD = '01J6Y6M0R2V9GKJ4W1T8Q3ZBAA';

    private const REPLY = '01J6Y6M0R2V9GKJ4W1T8Q3ZBAB';

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDocsFixtures();
        $this->seedDocFile('bob', 'plan.md', "# Plan\n\nInitial");
        app(WgwStorage::class)->files()->put(ltrim(self::GROUP_PATH, '/'), "# Team plan\n");
    }

    protected function tearDown(): void
    {
        $this->tearDownDocsFixtures();
        parent::tearDown();
    }

    public function test_failed_index_insert_rolls_back_the_thread_and_returns_409(): void
    {
        // Another pool already indexed this UID; its VJOURNAL is not visible yet.
        $this->indexElsewhere(self::THREAD);

        $this->createThread(self::PATH, self::THREAD)->assertStatus(409)->assertJsonPath('code', 'alreadyExists');
        $this->assertNoVJournalInBobsPool(self::THREAD);

        // A retry gets the same answer, never a 404 for a half-saved thread.
        $this->createThread(self::PATH, self::THREAD)->assertStatus(409);
        $this->assertNoVJournalInBobsPool(self::THREAD);
    }

    public function test_failed_index_insert_rolls_back_the_reply_and_returns_409(): void
    {
        $this->createThread(self::PATH, self::THREAD)->assertCreated();
        $this->indexElsewhere(self::REPLY);

        $this->replyTo(self::PATH, self::THREAD, self::REPLY)->assertStatus(409)->assertJsonPath('code', 'alreadyExists');
        $this->assertNoVJournalInBobsPool(self::REPLY);
        $this->assertCount(1, $this->threadsAt(self::PATH)[0]['messages']);
    }

    public function test_repeated_create_returns_the_existing_thread(): void
    {
        $first = $this->repository()->create($this->bob(), self::PATH, $this->threadPayload(self::THREAD));
        $again = $this->repository()->create($this->bob(), self::PATH, $this->threadPayload(self::THREAD));

        $this->assertTrue($first['created']);
        $this->assertFalse($again['created']);
        $this->assertSame(self::THREAD, $again['thread']['id']);
        $this->createThread(self::PATH, self::THREAD)->assertCreated()->assertJsonPath('id', self::THREAD);
        $this->assertSame(1, CalendarObject::query()->where('uid', self::THREAD)->count());
        $this->assertSame(1, DocsThreadIndex::query()->where('uid', self::THREAD)->count());
    }

    public function test_repeated_reply_returns_the_thread_without_a_second_message(): void
    {
        $this->createThread(self::PATH, self::THREAD)->assertCreated();

        $this->replyTo(self::PATH, self::THREAD, self::REPLY)->assertOk();
        $this->replyTo(self::PATH, self::THREAD, self::REPLY)->assertOk()->assertJsonCount(2, 'messages');

        $this->assertSame(1, CalendarObject::query()->where('uid', self::REPLY)->count());
        $this->assertSame(1, DocsThreadIndex::query()->where('uid', self::REPLY)->count());
    }

    public function test_same_thread_id_on_a_document_of_another_owner_is_409(): void
    {
        $this->createThread(self::PATH, self::THREAD)->assertCreated();

        $this->createThread(self::GROUP_PATH, self::THREAD)->assertStatus(409)->assertJsonPath('code', 'alreadyExists');

        $this->assertSame([], $this->threadsAt(self::GROUP_PATH));
        $this->assertSame(1, CalendarObject::query()->where('uid', self::THREAD)->count());
    }

    public function test_same_reply_id_on_a_document_of_another_owner_is_409(): void
    {
        $this->createThread(self::PATH, self::THREAD)->assertCreated();
        $this->replyTo(self::PATH, self::THREAD, self::REPLY)->assertOk();
        $groupThread = '01J6Y6M0R2V9GKJ4W1T8Q3ZBAC';
        $this->createThread(self::GROUP_PATH, $groupThread)->assertCreated();

        $this->replyTo(self::GROUP_PATH, $groupThread, self::REPLY)->assertStatus(409)->assertJsonPath('code', 'alreadyExists');

        $this->assertCount(1, $this->threadsAt(self::GROUP_PATH)[0]['messages']);
        $this->assertSame(1, CalendarObject::query()->where('uid', self::REPLY)->count());
    }

    public function test_other_database_errors_propagate_and_leave_no_thread(): void
    {
        Exceptions::fake();
        $this->bobsPool();
        Schema::connection('wgw')->dropIfExists('docs_thread_index');

        $this->createThread(self::PATH, self::THREAD)->assertStatus(500);

        Exceptions::assertReported(QueryException::class);
        $this->assertNoVJournalInBobsPool(self::THREAD);
    }

    private function indexElsewhere(string $uid): void
    {
        $other = app(DocsThreadPoolProvisioner::class)->ensureForOwner(DocsThreadCollectionUris::ownerPrincipalUri(self::GROUP_PATH));
        DocsThreadIndex::query()->create([
            'calendarid' => (int) $other->calendarid,
            'uid' => $uid,
            'doc_path' => self::GROUP_PATH,
            'kind' => DocsThreadIndex::KIND_COMMENT,
            'parent_uid' => null,
            'change_id' => null,
        ]);
    }

    private function assertNoVJournalInBobsPool(string $uid): void
    {
        $this->assertSame(0, CalendarObject::query()
            ->where('calendarid', (int) $this->bobsPool()->calendarid)
            ->where('uid', $uid)
            ->count());
    }

    private function bobsPool(): CalendarInstance
    {
        return app(DocsThreadPoolProvisioner::class)->ensureForOwner(DocsThreadCollectionUris::ownerPrincipalUri(self::PATH));
    }

    private function createThread(string $path, string $id): TestResponse
    {
        return $this->asBob()->postJson('/api/v1/files/threads?path='.urlencode($path), $this->threadPayload($id));
    }

    private function replyTo(string $path, string $threadId, string $id): TestResponse
    {
        return $this->asBob()->postJson('/api/v1/files/threads/'.$threadId.'/replies?path='.urlencode($path), [
            'id' => $id,
            'body' => 'working on it',
        ]);
    }

    /** @return list<array<string, mixed>> */
    private function threadsAt(string $path): array
    {
        /** @var list<array<string, mixed>> $list */
        $list = $this->asBob()->getJson('/api/v1/files/threads?path='.urlencode($path))->assertOk()->json('list');

        return $list;
    }

    /** @return array<string, mixed> */
    private function threadPayload(string $id): array
    {
        return [
            'id' => $id,
            'kind' => 'comment',
            'body' => 'please clarify',
            'anchorText' => 'Plan',
            'anchorFrom' => 0,
            'anchorTo' => 4,
            'anchorOccurrence' => 0,
        ];
    }

    private function repository(): DocsThreadRepository
    {
        return app(DocsThreadRepository::class);
    }

    /** @return array{username: string, role: string} */
    private function bob(): array
    {
        return ['username' => 'bob', 'role' => 'user'];
    }

    private function asBob(): self
    {
        return $this->withBearer($this->userBearerToken());
    }
}
