<?php

declare(strict_types=1);

namespace Tests\Feature\Docs;

use PHPUnit\Framework\Attributes\Group;
use Tests\Support\DocsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

#[Group('MySQLParity')]
final class DocsShareCollabTest extends WgwDatabaseTestCase
{
    use DocsTestFixtures;

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

    public function test_view_grant_can_read_collab_but_cannot_put(): void
    {
        $ownerToken = $this->userBearerToken();
        $this->withBearer($ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/docs/plan.md',
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['alice' => ['access' => 'view']],
        ])->assertOk();

        $aliceToken = $this->adminBearerToken();
        $this->withBearer($aliceToken)
            ->get('/api/v1/files/collaboration?path='.urlencode('/users/bob/docs/plan.md'))
            ->assertOk();

        $this->withBearer($aliceToken)
            ->putJson('/api/v1/files/collaboration?path='.urlencode('/users/bob/docs/plan.md'), [
                'markdown' => 'blocked',
            ])
            ->assertForbidden();

        $this->withBearer($aliceToken)
            ->getJson('/api/v1/files/shares/at-path?path='.urlencode('/users/bob/docs/plan.md'))
            ->assertOk()
            ->assertJsonPath('data.myRights.mayView', true)
            ->assertJsonPath('data.myRights.mayComment', false)
            ->assertJsonPath('data.myRights.mayReview', false)
            ->assertJsonPath('data.myRights.mayEditContent', false);
    }

    public function test_comment_grant_can_read_collab_but_cannot_put(): void
    {
        $ownerToken = $this->userBearerToken();
        $this->withBearer($ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/docs/plan.md',
            'kind' => 'member',
            'defaultAccess' => 'comment',
            'shareWith' => ['alice' => ['access' => 'comment']],
        ])->assertOk();

        $aliceToken = $this->adminBearerToken();
        $this->withBearer($aliceToken)
            ->get('/api/v1/files/collaboration?path='.urlencode('/users/bob/docs/plan.md'))
            ->assertOk();

        $this->withBearer($aliceToken)
            ->putJson('/api/v1/files/collaboration?path='.urlencode('/users/bob/docs/plan.md'), [
                'markdown' => 'blocked',
            ])
            ->assertForbidden();

        $this->withBearer($aliceToken)
            ->getJson('/api/v1/files/shares/at-path?path='.urlencode('/users/bob/docs/plan.md'))
            ->assertOk()
            ->assertJsonPath('data.myRights.mayComment', true)
            ->assertJsonPath('data.myRights.mayEditContent', false);
    }

    public function test_review_grant_is_normalized_to_edit_and_can_put(): void
    {
        $ownerToken = $this->userBearerToken();
        $this->withBearer($ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/docs/plan.md',
            'kind' => 'member',
            'defaultAccess' => 'review',
            'shareWith' => ['alice' => ['access' => 'review']],
        ])
            ->assertOk()
            ->assertJsonPath('data.defaultAccess', 'edit')
            ->assertJsonPath('data.shareWith.alice.access', 'edit');

        $aliceToken = $this->adminBearerToken();
        $this->withBearer($aliceToken)
            ->get('/api/v1/files/collaboration?path='.urlencode('/users/bob/docs/plan.md'))
            ->assertOk();

        $this->withBearer($aliceToken)
            ->putJson('/api/v1/files/collaboration?path='.urlencode('/users/bob/docs/plan.md'), [
                'markdown' => 'edited via legacy review grant',
            ])
            ->assertOk();

        $this->withBearer($aliceToken)
            ->getJson('/api/v1/files/shares/at-path?path='.urlencode('/users/bob/docs/plan.md'))
            ->assertOk()
            ->assertJsonPath('data.myRights.mayComment', true)
            ->assertJsonPath('data.myRights.mayReview', true)
            ->assertJsonPath('data.myRights.mayEditContent', true);
    }

    public function test_public_view_guest_cannot_join_collab_mesh(): void
    {
        $ownerToken = $this->userBearerToken();
        $share = $this->withBearer($ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/docs/plan.md',
            'kind' => 'public',
            'defaultAccess' => 'view',
        ])->assertOk();

        $guestToken = (string) $this->postJson('/api/v1/files/share-sessions', [
            'token' => (string) $share->json('data.publicToken'),
        ])->assertOk()->json('access_token');

        $this->withBearer($guestToken)
            ->get('/api/v1/files/collaboration?path='.urlencode('/users/bob/docs/plan.md'))
            ->assertForbidden();
    }
}
