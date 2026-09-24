<?php

declare(strict_types=1);

namespace Tests\Feature\Notify;

use App\Models\Notification;
use App\Services\Notify\DocsThreadActivityNotify;
use PHPUnit\Framework\Attributes\Group;
use Tests\Support\DocsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

#[Group('MySQLParity')]
final class DocsThreadActivityNotifyTest extends WgwDatabaseTestCase
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

    public function test_sharee_comment_notifies_owner_and_skips_actor(): void
    {
        $this->shareWithAliceComment();

        $rootId = $this->ulid('AA');
        $this->asAlice()->postJson($this->threadsPath(), [
            'id' => $rootId,
            'kind' => 'comment',
            'body' => 'please clarify',
            'anchorText' => 'Plan',
        ])->assertCreated();

        $this->assertSame(1, Notification::query()
            ->where('principal', 'bob')
            ->where('action', DocsThreadActivityNotify::ACTION)
            ->count());
        $this->assertSame(0, Notification::query()
            ->where('principal', 'alice')
            ->where('action', DocsThreadActivityNotify::ACTION)
            ->count());

        $bob = Notification::query()->where('principal', 'bob')->first();
        $this->assertNotNull($bob);
        $this->assertSame('docs', $bob->domain);
        $this->assertSame('Alice left a comment on plan.md', $bob->title);
        $this->assertSame('please clarify', $bob->body);
        $this->assertSame(DocsThreadActivityNotify::navigate(self::PATH), $bob->navigate);
        $this->assertSame($rootId, $bob->data['threadId'] ?? null);
        $this->assertFalse($bob->data['isReply'] ?? true);
    }

    public function test_reply_notifies_owner_and_prior_participant(): void
    {
        $this->shareWithAliceComment();

        $rootId = $this->ulid('AB');
        $this->asAlice()->postJson($this->threadsPath(), [
            'id' => $rootId,
            'kind' => 'comment',
            'body' => 'from alice',
            'anchorText' => 'Plan',
        ])->assertCreated();

        Notification::query()->delete();

        $this->asBob()->postJson($this->threadUrl($rootId.'/replies'), [
            'id' => $this->ulid('AC'),
            'body' => 'from owner',
        ])->assertOk();

        $this->assertSame(1, Notification::query()
            ->where('principal', 'alice')
            ->where('action', DocsThreadActivityNotify::ACTION)
            ->count());
        $this->assertSame(0, Notification::query()
            ->where('principal', 'bob')
            ->where('action', DocsThreadActivityNotify::ACTION)
            ->count());

        $alice = Notification::query()->where('principal', 'alice')->first();
        $this->assertNotNull($alice);
        $this->assertSame('Bob replied on plan.md', $alice->title);
        $this->assertTrue($alice->data['isReply'] ?? false);
    }

    public function test_mention_in_body_auto_subscribes_to_subsequent_activity(): void
    {
        $this->asBob()->postJson('/api/v1/files/shares', [
            'path' => self::PATH,
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => [
                'alice' => ['access' => 'comment'],
                'carol' => ['access' => 'comment'],
            ],
        ])->assertOk();

        $rootId = $this->ulid('AD');
        $this->asAlice()->postJson($this->threadsPath(), [
            'id' => $rootId,
            'kind' => 'comment',
            'body' => 'hey @carol please review',
            'anchorText' => 'Plan',
        ])->assertCreated();

        $this->assertSame(1, Notification::query()
            ->where('principal', 'carol')
            ->where('action', DocsThreadActivityNotify::ACTION)
            ->count());

        Notification::query()->delete();

        $this->asBob()->postJson($this->threadUrl($rootId.'/replies'), [
            'id' => $this->ulid('AE'),
            'body' => 'following up',
        ])->assertOk();

        $this->assertSame(1, Notification::query()
            ->where('principal', 'carol')
            ->where('action', DocsThreadActivityNotify::ACTION)
            ->count());
        $this->assertSame(1, Notification::query()
            ->where('principal', 'alice')
            ->where('action', DocsThreadActivityNotify::ACTION)
            ->count());
    }

    private function shareWithAliceComment(): void
    {
        $this->asBob()->postJson('/api/v1/files/shares', [
            'path' => self::PATH,
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => [
                'alice' => ['access' => 'comment'],
            ],
        ])->assertOk();
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
        return self::ULID_PREFIX.$suffix;
    }

    private function asBob()
    {
        return $this->withBearer($this->userBearerToken());
    }

    private function asAlice()
    {
        return $this->withBearer($this->issueBearerTokenFor('alice'));
    }
}
