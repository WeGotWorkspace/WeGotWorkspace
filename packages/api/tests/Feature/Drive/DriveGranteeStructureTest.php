<?php

declare(strict_types=1);

namespace Tests\Feature\Drive;

use App\Services\Drive\DriveService;
use App\Storage\WgwStorage;
use PHPUnit\Framework\Attributes\Group;
use Tests\Feature\Drive\Concerns\SharedWorkspaceFixture;
use Tests\Support\DriveTestFixtures;
use Tests\Support\InteractsWithFileNodeJmap;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Grantee structure rules for member shares (#990): the share root is off-limits,
 * moves stay inside the share, and destroy lands in the owner's trash.
 */
#[Group('MySQLParity')]
final class DriveGranteeStructureTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;
    use InteractsWithFileNodeJmap;
    use SharedWorkspaceFixture;

    public function test_editor_cannot_rename_move_or_destroy_the_share_root(): void
    {
        $workspaceId = $this->workspaceNodeId();
        $homeId = $this->fileNodeIdByName(
            $this->fileNodeGetAll('bob', $this->token('editor')),
            'bob',
        );

        $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'bob', 'update' => [
                $workspaceId => ['name' => 'renamed-workspace'],
            ]], 'c0'],
        ], $this->token('editor'))->assertOk()
            ->assertJsonPath('methodResponses.0.1.notUpdated.'.$workspaceId.'.type', 'forbidden');

        $this->moveNode('editor', $workspaceId, $homeId)->assertOk()
            ->assertJsonPath('methodResponses.0.1.notUpdated.'.$workspaceId.'.type', 'forbidden');

        $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'bob', 'destroy' => [$workspaceId]], 'c2'],
        ], $this->token('editor'))->assertOk()
            ->assertJsonPath('methodResponses.0.1.notDestroyed.'.$workspaceId.'.type', 'forbidden');

        $this->listWorkspace('owner')
            ->assertOk()
            ->assertJsonFragment(['name' => 'plan.md', 'type' => 'file']);
    }

    public function test_editor_cannot_delete_the_share_root_via_rest(): void
    {
        try {
            app(DriveService::class)->deleteItems(
                $this->drivePrincipal('bob'),
                [['path' => self::WORKSPACE]],
            );
            $this->fail('Expected the share root delete to be denied.');
        } catch (\InvalidArgumentException $e) {
            $this->assertSame('Access denied for this path.', $e->getMessage());
        }

        $this->listWorkspace('owner')
            ->assertOk()
            ->assertJsonFragment(['name' => 'plan.md', 'type' => 'file']);
    }

    public function test_editor_cannot_move_a_shared_file_into_their_home(): void
    {
        $planId = $this->planNodeId();
        $homeId = $this->fileNodeIdByName(
            $this->fileNodeGetAll('bob', $this->token('editor')),
            'bob',
        );

        $this->moveNode('editor', $planId, $homeId)->assertOk()
            ->assertJsonPath('methodResponses.0.1.notUpdated.'.$planId.'.type', 'forbidden');

        $this->listWorkspace('editor')
            ->assertOk()
            ->assertJsonFragment(['name' => 'plan.md', 'type' => 'file']);
    }

    public function test_editor_cannot_move_a_home_file_into_the_share(): void
    {
        app(WgwStorage::class)->files()->put('users/bob/local.md', 'bob-local');
        $localId = $this->fileNodeIdByName(
            $this->fileNodeGetAll('bob', $this->token('editor')),
            'local.md',
        );

        $this->moveNode('editor', $localId, $this->workspaceNodeId())->assertOk()
            ->assertJsonPath('methodResponses.0.1.notUpdated.'.$localId.'.type', 'forbidden');

        $local = $this->download('/users/bob/local.md', 'editor');
        $local->assertOk();
        $this->assertSame('bob-local', $local->streamedContent());
        $this->listWorkspace('owner')
            ->assertOk()
            ->assertJsonMissing(['name' => 'local.md']);
    }

    public function test_editor_can_query_share_children_but_share_root_is_not_top_level(): void
    {
        $workspaceId = $this->workspaceNodeId();
        $planId = $this->planNodeId();

        $query = $this->fileNodeJmap([
            ['FileNode/query', ['accountId' => 'bob', 'filter' => ['parentId' => $workspaceId]], 'q0'],
            ['FileNode/query', ['accountId' => 'bob', 'filter' => ['isTopLevel' => true]], 'q1'],
        ], $this->token('editor'))->assertOk();

        $this->assertContains($planId, $query->json('methodResponses.0.1.ids'));
        $this->assertNotContains($workspaceId, $query->json('methodResponses.1.1.ids'));
    }

    public function test_user_without_a_grant_cannot_get_the_share_root(): void
    {
        $this->seedDave();
        $workspaceId = $this->workspaceNodeId();

        $this->fileNodeJmap([
            ['FileNode/get', ['accountId' => 'dave', 'ids' => [$workspaceId]], 'g0'],
        ], $this->token('dave'))->assertOk()
            ->assertJsonPath('methodResponses.0.1.notFound.0', $workspaceId);
    }

    public function test_revoked_editor_can_no_longer_get_the_shared_file(): void
    {
        $planId = $this->planNodeId();
        $this->patchGrant('bob', null);

        $this->fileNodeJmap([
            ['FileNode/get', ['accountId' => 'bob', 'ids' => [$planId]], 'g0'],
        ], $this->token('editor'))->assertOk()
            ->assertJsonPath('methodResponses.0.1.notFound.0', $planId);
    }

    public function test_owner_rename_of_the_share_root_follows_the_grant(): void
    {
        $workspaceId = $this->workspaceNodeId();

        $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'alice', 'update' => [
                $workspaceId => ['name' => 'workspace-renamed'],
            ]], 'c0'],
        ], $this->token('owner'))->assertOk()
            ->assertJsonPath('methodResponses.0.1.updated.'.$workspaceId, null);

        $this->withBearer($this->token('editor'))
            ->getJson('/api/v1/files/shared-with-me')
            ->assertOk()
            ->assertJsonPath('data.0.share.path', '/users/alice/workspace-renamed');

        $this->withBearer($this->token('editor'))
            ->getJson('/api/v1/files/shares/at-path?path='.urlencode('/users/alice/workspace-renamed/plan.md'))
            ->assertOk()
            ->assertJsonPath('data.myRights.mayView', true);
    }

    public function test_shared_with_me_exposes_the_share_root_node_without_structure_rights(): void
    {
        $workspaceId = $this->workspaceNodeId();

        $this->withBearer($this->token('editor'))
            ->getJson('/api/v1/files/shared-with-me')
            ->assertOk()
            ->assertJsonPath('data.0.fileNodeId', $workspaceId)
            ->assertJsonPath('data.0.entry.myRights.mayManageStructure', false);
    }

    public function test_grantee_cannot_move_a_shared_file_into_their_own_trash(): void
    {
        $planId = $this->planNodeId();

        foreach (['editor', 'viewer'] as $role) {
            $this->moveNode($role, $planId, $this->ensureActorTrashNodeId($role))->assertOk()
                ->assertJsonPath('methodResponses.0.1.notUpdated.'.$planId.'.type', 'forbidden');
        }

        $this->listWorkspace('owner')
            ->assertOk()
            ->assertJsonFragment(['name' => 'plan.md', 'type' => 'file']);
    }

    public function test_viewer_destroy_does_not_trash_the_shared_file(): void
    {
        $planId = $this->planNodeId();

        $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'carol', 'destroy' => [$planId]], 'c0'],
        ], $this->token('viewer'))->assertOk()
            ->assertJsonPath('methodResponses.0.1.notDestroyed.'.$planId.'.type', 'forbidden');

        $this->withBearer($this->token('owner'))
            ->getJson('/api/v1/files/children?path='.urlencode(self::OWNER_TRASH))
            ->assertOk()
            ->assertJsonMissing(['name' => 'plan.md']);
        $this->listWorkspace('owner')
            ->assertOk()
            ->assertJsonFragment(['name' => 'plan.md', 'type' => 'file']);
    }
}
