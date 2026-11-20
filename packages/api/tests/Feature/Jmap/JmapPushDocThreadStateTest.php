<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Storage\WgwStorage;
use Illuminate\Support\Facades\Cache;
use Tests\Support\DocsTestFixtures;
use Tests\Support\InteractsWithJmapEventSource;
use Tests\Support\SeedsWgwIdentity;
use Tests\Support\WgwDatabaseTestCase;

/**
 * The `DocThread` push type (#2286): a thread write moves the state of everyone who can read
 * that thread, and of nobody else. Open documents pull `files/threads/changes` on it instead
 * of polling every 4 s.
 */
final class JmapPushDocThreadStateTest extends WgwDatabaseTestCase
{
    use DocsTestFixtures;
    use InteractsWithJmapEventSource;
    use SeedsWgwIdentity;

    private const PLAN = '/users/bob/docs/plan.md';

    private const SECRET = '/users/bob/docs/secret.md';

    private const TEAM_DOC = '/groups/studio/brief.md';

    private int $ulids = 0;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDocsFixtures();
        Cache::flush();
        $this->seedDocFile('bob', 'plan.md', "# Plan\n");
        $this->seedDocFile('bob', 'secret.md', "# Secret\n");
        app(WgwStorage::class)->files()->put(ltrim(self::TEAM_DOC, '/'), "# Brief\n");
        // alice is in studio with bob; carol is bob's colleague in another Team (so he may share
        // with her, Epic #1915) and not in studio.
        $this->seedSharedTeam('studio', 'bob', 'alice');
        $this->seedSharedTeam('clients', 'bob', 'carol');
    }

    protected function tearDown(): void
    {
        $this->tearDownDocsFixtures();
        parent::tearDown();
    }

    public function test_the_type_is_served_with_the_drive_app(): void
    {
        $changed = $this->changedStates($this->readEventSource($this->token('bob'), 'DocThread'), 'bob');

        $this->assertSame(['DocThread'], array_keys($changed));
        $this->assertSame('0:', $changed['DocThread'], 'No pool yet: an empty composite.');
    }

    public function test_an_own_comment_moves_the_owner_and_not_an_outsider(): void
    {
        $bob = $this->firstId('bob');
        $carol = $this->firstId('carol');

        $this->comment('bob', self::PLAN);

        $this->assertChanged('bob', $bob);
        $this->assertNothingChanged('carol', $carol);
    }

    public function test_a_team_comment_moves_members_and_not_others(): void
    {
        $bob = $this->firstId('bob');
        $carol = $this->firstId('carol');

        $this->comment('alice', self::TEAM_DOC);

        $this->assertChanged('bob', $bob);
        $this->assertNothingChanged('carol', $carol);
    }

    public function test_a_grantee_sees_threads_on_the_shared_document_only(): void
    {
        $this->asUser('bob')->postJson('/api/v1/files/shares', [
            'path' => self::PLAN,
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['carol' => ['access' => 'comment']],
        ])->assertOk();
        // The pool exists before the first reads, so only thread writes move the states below.
        $this->comment('bob', self::SECRET);
        $carol = $this->firstId('carol');

        // Another document of the same owner: carol cannot read it, so her state stays.
        $this->comment('bob', self::SECRET);
        $this->assertNothingChanged('carol', $carol);

        $this->comment('bob', self::PLAN);
        $carol = $this->assertChanged('carol', $carol);

        // The grantee's own comment, and a reply on it, move her state too.
        $root = $this->comment('carol', self::PLAN);
        $carol = $this->assertChanged('carol', $carol);
        $this->asUser('bob')->postJson($this->threadsUrl(self::PLAN, $root.'/replies'), [
            'id' => $this->ulid(),
            'body' => 'Agreed',
        ])->assertOk();
        $this->assertChanged('carol', $carol);
    }

    public function test_revoking_a_share_takes_its_threads_out_of_the_state(): void
    {
        $shareId = $this->asUser('bob')->postJson('/api/v1/files/shares', [
            'path' => self::PLAN,
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['carol' => ['access' => 'comment']],
        ])->assertOk()->json('data.id');
        $this->assertIsString($shareId);
        $this->comment('bob', self::PLAN);
        $shared = $this->changedStates($this->readEventSource($this->token('carol'), 'DocThread'), 'carol')['DocThread'];
        $this->assertStringStartsWith('1:share-', $shared);

        $this->asUser('bob')->deleteJson('/api/v1/files/shares/'.$shareId)
            ->assertSuccessful();

        $this->assertSame('0:', $this->changedStates($this->readEventSource($this->token('carol'), 'DocThread'), 'carol')['DocThread']);
    }

    private function comment(string $username, string $path): string
    {
        $id = $this->ulid();
        $this->asUser($username)->postJson($this->threadsUrl($path, null), [
            'id' => $id,
            'kind' => 'comment',
            'body' => 'A note',
            'anchorText' => 'Plan',
        ])->assertCreated();

        return $id;
    }

    private function firstId(string $username): string
    {
        $id = $this->readEventSource($this->token($username), 'DocThread')['id'];
        $this->assertIsString($id);

        return $id;
    }

    /** Asserts that only `DocThread` changed since `$id`; returns the new id. */
    private function assertChanged(string $username, string $id): string
    {
        $stream = $this->readEventSource($this->token($username), 'DocThread', $id);
        $this->assertSame(['DocThread'], array_keys($this->changedStates($stream, $username)));
        $this->assertIsString($stream['id']);

        return $stream['id'];
    }

    private function assertNothingChanged(string $username, string $id): void
    {
        $this->assertSame("retry: 3000\n\n", $this->eventSource($this->token($username), 'DocThread', $id)->getContent());
    }

    private function threadsUrl(string $path, ?string $suffix): string
    {
        return '/api/v1/files/threads'.($suffix !== null ? '/'.$suffix : '').'?path='.urlencode($path);
    }

    private function ulid(): string
    {
        return '01J6Y6M0R2V9GKJ4W1T8Q3ZB'.sprintf('%02d', ++$this->ulids);
    }

    private function token(string $username): string
    {
        return $this->issueBearerTokenFor($username);
    }

    private function asUser(string $username): self
    {
        return $this->withBearer($this->token($username));
    }
}
