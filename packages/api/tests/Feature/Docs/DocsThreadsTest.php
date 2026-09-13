<?php

declare(strict_types=1);

namespace Tests\Feature\Docs;

use App\Events\DocsThreadPosted;
use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use App\Services\Docs\DocsThreadRepository;
use Illuminate\Support\Facades\Event;
use PHPUnit\Framework\Attributes\Group;
use Tests\Support\DocsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

#[Group('MySQLParity')]
final class DocsThreadsTest extends WgwDatabaseTestCase
{
    use DocsTestFixtures;

    private const ULID_PREFIX = '01J6Y6M0R2V9GKJ4W1T8Q3ZB';

    private const PATH = '/users/bob/docs/plan.md';

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDocsFixtures();
        $this->seedDocFile('bob', 'plan.md', "# Plan\n\nInitial");
    }

    protected function tearDown(): void
    {
        $this->tearDownDocsFixtures();
        parent::tearDown();
    }

    public function test_owner_create_list_reply_and_reload(): void
    {
        $rootId = $this->ulid('AA');
        $created = $this->asBob()->postJson($this->threadsPath(), [
            'id' => $rootId,
            'kind' => 'comment',
            'body' => 'please clarify',
            'anchorText' => 'Plan',
            'anchorFrom' => 0,
            'anchorTo' => 4,
            'anchorOccurrence' => 0,
        ])->assertCreated()->json();

        $this->assertSame($rootId, $created['id']);
        $this->assertSame('comment', $created['kind']);
        $this->assertSame(self::PATH, $created['path']);
        $this->assertSame('bob', $created['createdBy']['id']);
        $this->assertSame('please clarify', $created['messages'][0]['body']);
        $this->assertFalse($created['resolved']);
        $this->assertFalse($created['archived']);

        $replyId = $this->ulid('AB');
        $this->asBob()->postJson($this->threadUrl($rootId.'/replies'), [
            'id' => $replyId,
            'body' => 'working on it',
        ])->assertOk();

        $list = $this->asBob()->getJson($this->threadsPath())->assertOk()->json('list');
        $this->assertCount(1, $list);
        $this->assertCount(2, $list[0]['messages']);
        $this->assertSame($replyId, $list[0]['messages'][1]['id']);
        $this->assertSame('working on it', $list[0]['messages'][1]['body']);

        $this->assertGreaterThan(0, CalendarObject::query()->where('uid', $rootId)->count());
        $reloaded = $this->asBob()->getJson($this->threadsPath())->assertOk()->json('list');
        $this->assertSame($rootId, $reloaded[0]['id']);
        $this->assertCount(2, $reloaded[0]['messages']);
    }

    public function test_comment_sharee_can_persist_view_only_cannot(): void
    {
        $this->asBob()->postJson('/api/v1/files/shares', [
            'path' => self::PATH,
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => [
                'alice' => ['access' => 'comment'],
                'carol' => ['access' => 'view'],
            ],
        ])->assertOk();

        Event::fake([DocsThreadPosted::class]);

        $rootId = $this->ulid('AC');
        $this->asAlice()->postJson($this->threadsPath(), [
            'id' => $rootId,
            'kind' => 'comment',
            'body' => 'from comment grant',
            'anchorText' => 'Plan',
        ])->assertCreated();

        Event::assertDispatched(DocsThreadPosted::class, function (DocsThreadPosted $event): bool {
            return $event->name === 'docs.comment_posted'
                && $event->payload['path'] === self::PATH
                && $event->payload['kind'] === 'comment'
                && $event->payload['actor'] === 'alice';
        });

        $this->assertSame(
            0,
            CalendarInstance::query()
                ->where('principaluri', 'principals/alice')
                ->where('uri', 'docs-threads')
                ->count(),
        );
        $bobPool = CalendarInstance::query()
            ->where('principaluri', 'principals/bob')
            ->where('uri', 'docs-threads')
            ->first();
        $this->assertNotNull($bobPool);
        $this->assertSame(
            0,
            CalendarInstance::query()
                ->where('calendarid', (int) $bobPool->calendarid)
                ->where('principaluri', '!=', 'principals/bob')
                ->count(),
        );

        $this->asCarol()->postJson($this->threadsPath(), [
            'id' => $this->ulid('AD'),
            'kind' => 'comment',
            'body' => 'should fail',
            'anchorText' => 'Plan',
        ])->assertForbidden();

        $this->asCarol()->getJson($this->threadsPath())->assertOk()
            ->assertJsonPath('list.0.id', $rootId);
    }

    public function test_suggestion_posted_event_and_archive_hides_from_list(): void
    {
        Event::fake([DocsThreadPosted::class]);
        $rootId = $this->ulid('AE');
        $this->asBob()->postJson($this->threadsPath(), [
            'id' => $rootId,
            'kind' => 'suggestion',
            'changeId' => 'change-1',
            'body' => 'why this edit?',
        ])->assertCreated();

        Event::assertDispatched(DocsThreadPosted::class, function (DocsThreadPosted $event) use ($rootId): bool {
            return $event->name === 'docs.suggestion_posted'
                && $event->payload['threadId'] === $rootId
                && $event->payload['kind'] === 'suggestion';
        });

        $this->asBob()->patchJson($this->threadUrl($rootId), [
            'archived' => true,
            'changeId' => 'change-1',
        ])->assertOk()->assertJsonPath('archived', true);

        $this->assertTrue(CalendarObject::query()->where('uid', $rootId)->exists());
        $list = $this->asBob()->getJson($this->threadsPath())->assertOk()->json('list');
        $this->assertCount(0, $list);
    }

    public function test_idempotent_create_and_changes_feed(): void
    {
        $rootId = $this->ulid('AF');
        $this->asBob()->postJson($this->threadsPath(), [
            'id' => $rootId,
            'kind' => 'comment',
            'body' => 'first',
            'anchorText' => 'Plan',
        ])->assertCreated();
        $this->asBob()->postJson($this->threadsPath(), [
            'id' => $rootId,
            'kind' => 'comment',
            'body' => 'retry must not win',
            'anchorText' => 'Plan',
        ])->assertCreated()->assertJsonPath('messages.0.body', 'first');

        $changes = $this->asBob()->getJson($this->threadUrl('changes'))->assertOk()->json();
        $this->assertContains($rootId, $changes['created']);
        $this->assertNotSame('', $changes['newState']);
    }

    public function test_reactions_and_resolve(): void
    {
        $rootId = $this->ulid('AG');
        $this->asBob()->postJson($this->threadsPath(), [
            'id' => $rootId,
            'kind' => 'comment',
            'body' => 'root',
            'anchorText' => 'Plan',
        ])->assertCreated();

        $this->asBob()->postJson($this->threadUrl($rootId.'/reactions'), [
            'emoji' => '👍',
        ])->assertOk()->assertJsonPath('reactions.0.emoji', '👍')
            ->assertJsonPath('reactions.0.userIds.0', 'bob');

        $this->asBob()->patchJson($this->threadUrl($rootId), [
            'resolved' => true,
        ])->assertOk()->assertJsonPath('resolved', true);
    }

    public function test_orphan_suggestions_are_archived_not_deleted(): void
    {
        $keep = $this->ulid('AH');
        $orphan = $this->ulid('AJ');
        $this->asBob()->postJson($this->threadsPath(), [
            'id' => $keep,
            'kind' => 'suggestion',
            'changeId' => 'keep',
            'body' => 'keep this',
        ])->assertCreated();
        $this->asBob()->postJson($this->threadsPath(), [
            'id' => $orphan,
            'kind' => 'suggestion',
            'changeId' => 'gone',
            'body' => 'orphan',
        ])->assertCreated();

        $repo = $this->app->make(DocsThreadRepository::class);
        $repo->archiveOrphanSuggestions(
            ['username' => 'bob', 'role' => 'user'],
            self::PATH,
            ['keep'],
        );

        $this->assertTrue(CalendarObject::query()->where('uid', $orphan)->exists());
        $list = $this->asBob()->getJson($this->threadsPath())->assertOk()->json('list');
        $this->assertCount(1, $list);
        $this->assertSame($keep, $list[0]['id']);
        $this->assertSame('keep', $list[0]['changeId']);
    }

    private function threadsPath(): string
    {
        return $this->threadUrl(null);
    }

    private function threadUrl(?string $suffix): string
    {
        $base = '/api/v1/files/threads'.($suffix !== null && $suffix !== '' ? '/'.$suffix : '');

        return $base.'?path='.urlencode(self::PATH);
    }

    private function ulid(string $suffix): string
    {
        return self::ULID_PREFIX.strtoupper($suffix);
    }

    private function asBob()
    {
        return $this->withBearer($this->userBearerToken());
    }

    private function asAlice()
    {
        return $this->withBearer($this->adminBearerToken());
    }

    private function asCarol()
    {
        return $this->withBearer($this->carolBearerToken());
    }
}
