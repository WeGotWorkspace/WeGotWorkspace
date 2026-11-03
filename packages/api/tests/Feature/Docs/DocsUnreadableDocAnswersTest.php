<?php

declare(strict_types=1);

namespace Tests\Feature\Docs;

use Illuminate\Testing\TestResponse;
use Tests\Support\DocsTestFixtures;
use Tests\Support\SendsFramedCollaboration;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Collaboration and thread routes answer 404 for a Doc the caller may not read, the same
 * as for a missing Doc. A reader that lacks a further right gets 403.
 */
final class DocsUnreadableDocAnswersTest extends WgwDatabaseTestCase
{
    use DocsTestFixtures;
    use SendsFramedCollaboration;

    private const PATH = '/users/bob/docs/plan.md';

    private const ULID = '01J6Y6M0R2V9GKJ4W1T8Q3ZBAA';

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

    public function test_collaboration_on_an_unreadable_doc_answers_like_a_missing_doc(): void
    {
        $carol = $this->carolBearerToken();

        foreach ([self::PATH, '/users/bob/docs/missing.md', '/users/nobody-here/docs/x.md'] as $path) {
            $this->withBearer($carol)->get($this->collabUrl($path))
                ->assertNotFound()
                ->assertExactJson(['error' => 'not_found']);
            $this->withBearer($carol)->putCollaboration($this->collabUrl($path), 'overwrite')
                ->assertNotFound()
                ->assertExactJson(['error' => 'not_found']);
        }
        $this->assertSame("# Plan\n\nInitial", $this->getDocContent($this->userBearerToken(), self::PATH)->streamedContent());
    }

    public function test_collaboration_with_a_parent_segment_is_not_found(): void
    {
        $this->withBearer($this->userBearerToken())->get($this->collabUrl('/users/bob/docs/../../carol/x.md'))
            ->assertNotFound()
            ->assertExactJson(['error' => 'not_found']);
    }

    public function test_a_view_sharee_reads_but_may_not_save_and_loses_the_doc_on_revoke(): void
    {
        $share = $this->withBearer($this->userBearerToken())->postJson('/api/v1/files/shares', [
            'path' => self::PATH,
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['carol' => ['access' => 'view']],
        ])->assertOk();
        $carol = $this->carolBearerToken();

        $this->withBearer($carol)->get($this->collabUrl(self::PATH))->assertOk();
        $this->withBearer($carol)->putCollaboration($this->collabUrl(self::PATH), 'blocked')
            ->assertForbidden()
            ->assertExactJson(['error' => 'forbidden']);

        $this->withBearer($this->userBearerToken())
            ->deleteJson('/api/v1/files/shares/'.$share->json('data.id'))
            ->assertOk();

        $this->withBearer($carol)->get($this->collabUrl(self::PATH))
            ->assertNotFound()
            ->assertExactJson(['error' => 'not_found']);
    }

    public function test_a_share_link_guest_is_refused_live_collaboration_inside_and_outside_its_link(): void
    {
        $this->seedDocFile('bob', 'other.md', 'other');
        $share = $this->withBearer($this->userBearerToken())->postJson('/api/v1/files/shares', [
            'path' => self::PATH,
            'kind' => 'public',
            'defaultAccess' => 'view',
        ])->assertOk();
        $guest = (string) $this->postJson('/api/v1/files/share-sessions', [
            'token' => (string) $share->json('data.publicToken'),
        ])->assertOk()->json('access_token');

        foreach ([self::PATH, '/users/bob/docs/other.md'] as $path) {
            $this->withBearer($guest)->get($this->collabUrl($path))
                ->assertForbidden()
                ->assertExactJson(['error' => 'forbidden']);
        }
    }

    public function test_thread_routes_on_an_unreadable_doc_answer_like_a_missing_doc(): void
    {
        $this->withBearer($this->userBearerToken())->postJson($this->threadsUrl(self::PATH), [
            'id' => self::ULID,
            'kind' => 'comment',
            'body' => 'owner note',
            'anchorText' => 'Plan',
        ])->assertCreated();
        $carol = $this->carolBearerToken();

        foreach ([self::PATH, '/users/bob/docs/missing.md'] as $path) {
            $this->assertDocNotFound($this->withBearer($carol)->getJson($this->threadsUrl($path)));
            $this->assertDocNotFound($this->withBearer($carol)->getJson($this->threadsUrl($path, 'changes')));
            $this->assertDocNotFound($this->withBearer($carol)->postJson($this->threadsUrl($path), [
                'id' => '01J6Y6M0R2V9GKJ4W1T8Q3ZBAB',
                'kind' => 'comment',
                'body' => 'not allowed',
                'anchorText' => 'Plan',
            ]));
            $this->assertDocNotFound($this->withBearer($carol)->postJson($this->threadsUrl($path, self::ULID.'/replies'), [
                'id' => '01J6Y6M0R2V9GKJ4W1T8Q3ZBAC',
                'body' => 'not allowed',
            ]));
            $this->assertDocNotFound($this->withBearer($carol)->patchJson($this->threadsUrl($path, self::ULID), [
                'resolved' => true,
            ]));
        }

        $list = $this->withBearer($this->userBearerToken())->getJson($this->threadsUrl(self::PATH))->assertOk()->json('list');
        $this->assertCount(1, $list);
        $this->assertCount(1, $list[0]['messages']);
        $this->assertFalse($list[0]['resolved']);
    }

    public function test_a_view_sharee_lists_threads_but_may_not_comment(): void
    {
        $this->withBearer($this->userBearerToken())->postJson('/api/v1/files/shares', [
            'path' => self::PATH,
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['carol' => ['access' => 'view']],
        ])->assertOk();
        $carol = $this->carolBearerToken();

        $this->withBearer($carol)->getJson($this->threadsUrl(self::PATH))->assertOk();
        $this->withBearer($carol)->postJson($this->threadsUrl(self::PATH), [
            'id' => self::ULID,
            'kind' => 'comment',
            'body' => 'view only',
            'anchorText' => 'Plan',
        ])->assertForbidden()->assertJsonPath('code', 'forbidden');
    }

    private function assertDocNotFound(TestResponse $response): void
    {
        $response->assertNotFound()
            ->assertJsonPath('code', 'not_found')
            ->assertJsonPath('error', 'Document not found.');
    }

    private function collabUrl(string $path): string
    {
        return '/api/v1/files/collaboration?path='.urlencode($path);
    }

    private function threadsUrl(string $path, ?string $suffix = null): string
    {
        return '/api/v1/files/threads'.($suffix !== null ? '/'.$suffix : '').'?path='.urlencode($path);
    }
}
