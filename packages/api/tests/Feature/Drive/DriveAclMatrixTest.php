<?php

declare(strict_types=1);

namespace Tests\Feature\Drive;

use App\Storage\WgwStorage;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;
use Tests\Feature\Drive\Concerns\SharedWorkspaceFixture;
use Tests\Support\DriveTestFixtures;
use Tests\Support\InteractsWithFileNodeJmap;
use Tests\Support\WgwDatabaseTestCase;

/**
 * HTTP baseline for drive ACL after the DriveShareService split (#997).
 *
 * Alice owns /users/alice/workspace. Bob is an editor (member grant "full":
 * content and structure rights, no sharing). Carol is a viewer (grant "view").
 * Dave is seeded only when a test needs an unrelated or email-invited user.
 *
 * Reads and content writes use /api/v1/files. Folder create, move, trash,
 * restore, and delete use FileNode/set on POST /api/v1/jmap. Product trash
 * for an owner is /users/{actor}/.Trash. An editor destroying a node inside
 * the share moves it into the owner's trash (/users/alice/.Trash) instead of
 * hard-deleting it; the owner can restore it. Moving a shared node into the
 * grantee's own trash is a cross-scope move and stays forbidden. Share grant,
 * change, revoke, and email invite use /api/v1/files/shares.
 */
#[Group('MySQLParity')]
final class DriveAclMatrixTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;
    use InteractsWithFileNodeJmap;
    use SharedWorkspaceFixture;

    /**
     * @return iterable<string, array{0: string}>
     */
    public static function roleProvider(): iterable
    {
        yield 'owner' => ['owner'];
        yield 'editor' => ['editor'];
        yield 'viewer' => ['viewer'];
    }

    /**
     * @return iterable<string, array{0: string, 1: int}>
     */
    public static function contentWriteProvider(): iterable
    {
        yield 'owner' => ['owner', 200];
        yield 'editor' => ['editor', 200];
        yield 'viewer' => ['viewer', 403];
    }

    /**
     * @return iterable<string, array{0: string, 1: bool, 2: bool, 3: bool}>
     */
    public static function rightsProvider(): iterable
    {
        yield 'owner' => ['owner', true, true, true];
        yield 'editor' => ['editor', true, true, false];
        yield 'viewer' => ['viewer', false, false, false];
    }

    /**
     * @return iterable<string, array{0: string}>
     */
    public static function granteeProvider(): iterable
    {
        yield 'editor' => ['editor'];
        yield 'viewer' => ['viewer'];
    }

    #[DataProvider('roleProvider')]
    public function test_shared_workspace_reads_are_allowed(string $role): void
    {
        $this->listWorkspace($role)
            ->assertOk()
            ->assertJsonPath('data.location', self::WORKSPACE.'/')
            ->assertJsonFragment(['name' => 'plan.md', 'type' => 'file']);

        $download = $this->download(self::PLAN, $role);
        $download->assertOk();
        $this->assertSame(self::PLAN_BODY, $download->streamedContent());

        $collab = $this->readCollab(self::PLAN, $role);
        $collab->assertOk();
        $this->assertSame(self::PLAN_BODY, $collab->getContent());
    }

    #[DataProvider('granteeProvider')]
    public function test_grantee_cannot_read_outside_the_share(string $role): void
    {
        $this->withBearer($this->token($role))
            ->getJson('/api/v1/files/children?path=/users/alice')
            ->assertStatus(400)
            ->assertJsonPath('error', 'Access denied for this path.');

        $this->download(self::PRIVATE_FILE, $role)
            ->assertStatus(400)
            ->assertJsonPath('error', 'Access denied for this path.');

        $this->readCollab(self::PRIVATE_FILE, $role)
            ->assertForbidden()
            ->assertJsonPath('error', 'forbidden');
    }

    public function test_owner_can_read_files_outside_the_share(): void
    {
        $this->withBearer($this->token('owner'))
            ->getJson('/api/v1/files/children?path=/users/alice')
            ->assertOk()
            ->assertJsonFragment(['name' => 'private.md', 'type' => 'file']);

        $download = $this->download(self::PRIVATE_FILE, 'owner');
        $download->assertOk();
        $this->assertSame(self::PRIVATE_BODY, $download->streamedContent());
    }

    #[DataProvider('contentWriteProvider')]
    public function test_content_update_follows_role(string $role, int $status): void
    {
        $body = "updated-by-{$role}";
        $write = $this->writeCollab(self::PLAN, $role, $body);
        $write->assertStatus($status);

        if ($status === 200) {
            $this->assertSame($body, $this->readCollab(self::PLAN, $role)->assertOk()->getContent());
            $download = $this->download(self::PLAN, 'owner');
            $download->assertOk();
            $this->assertSame($body, $download->streamedContent());

            return;
        }

        $write->assertJsonPath('error', 'forbidden');
        $this->assertSame(self::PLAN_BODY, $this->readCollab(self::PLAN, 'owner')->assertOk()->getContent());
    }

    public function test_editor_can_create_a_file_in_the_shared_folder(): void
    {
        $path = self::WORKSPACE.'/editor-note.md';
        $body = 'editor draft';

        $this->writeCollab($path, 'editor', $body)->assertOk();

        $this->listWorkspace('editor')
            ->assertOk()
            ->assertJsonFragment(['name' => 'editor-note.md', 'type' => 'file']);
        $download = $this->download($path, 'viewer');
        $download->assertOk();
        $this->assertSame($body, $download->streamedContent());
    }

    public function test_viewer_cannot_create_a_file(): void
    {
        $path = self::WORKSPACE.'/viewer-note.md';

        $this->writeCollab($path, 'viewer', "nope\n")
            ->assertForbidden()
            ->assertJsonPath('error', 'forbidden');

        $this->download($path, 'owner')
            ->assertStatus(400)
            ->assertJsonPath('error', 'File not found.');
    }

    public function test_owner_can_create_folder_move_and_delete(): void
    {
        $workspaceId = $this->workspaceNodeId();
        $createdDir = $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'alice', 'create' => [
                'd0' => ['parentId' => $workspaceId, 'name' => 'archive', 'nodeType' => 'directory'],
            ]], 'c0'],
        ], $this->token('owner'))->assertOk();
        $createdDir->assertJsonPath('methodResponses.0.1.created.d0.name', 'archive');
        $archiveId = (string) $createdDir->json('methodResponses.0.1.created.d0.id');

        $blobId = $this->uploadFileNodeBlob('move me', 'alice', $this->token('owner'));
        $createdFile = $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'alice', 'create' => [
                'f0' => ['parentId' => $workspaceId, 'name' => 'movable.txt', 'blobId' => $blobId],
            ]], 'c0'],
        ], $this->token('owner'))->assertOk();
        $createdFile->assertJsonPath('methodResponses.0.1.created.f0.name', 'movable.txt');
        $fileId = (string) $createdFile->json('methodResponses.0.1.created.f0.id');

        $this->listWorkspace('owner')
            ->assertOk()
            ->assertJsonFragment(['name' => 'archive', 'type' => 'dir'])
            ->assertJsonFragment(['name' => 'movable.txt', 'type' => 'file']);

        $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'alice', 'update' => [
                $fileId => ['parentId' => $archiveId],
            ]], 'c1'],
        ], $this->token('owner'))->assertOk()
            ->assertJsonPath('methodResponses.0.1.updated.'.$fileId, null);

        $this->listWorkspace('owner')
            ->assertOk()
            ->assertJsonMissing(['name' => 'movable.txt']);
        $this->withBearer($this->token('owner'))
            ->getJson('/api/v1/files/children?path='.urlencode(self::WORKSPACE.'/archive'))
            ->assertOk()
            ->assertJsonFragment(['name' => 'movable.txt', 'type' => 'file']);

        $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'alice', 'destroy' => [$fileId]], 'c2'],
        ], $this->token('owner'))->assertOk()
            ->assertJsonPath('methodResponses.0.1.destroyed.0', $fileId);

        $this->withBearer($this->token('owner'))
            ->getJson('/api/v1/files/children?path='.urlencode(self::WORKSPACE.'/archive'))
            ->assertOk()
            ->assertJsonMissing(['name' => 'movable.txt']);
    }

    public function test_viewer_cannot_create_folder_rename_or_delete_shared_nodes(): void
    {
        $workspaceId = $this->workspaceNodeId();
        $planId = $this->planNodeId();

        $create = $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'carol', 'create' => [
                'd0' => ['parentId' => $workspaceId, 'name' => 'viewer-dir', 'nodeType' => 'directory'],
            ]], 'c0'],
        ], $this->token('viewer'))->assertOk();
        $create->assertJsonPath('methodResponses.0.1.notCreated.d0.type', 'forbidden');

        $rename = $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'carol', 'update' => [
                $planId => ['name' => 'viewer-renamed.md'],
            ]], 'c1'],
        ], $this->token('viewer'))->assertOk();
        $rename->assertJsonPath('methodResponses.0.1.notUpdated.'.$planId.'.type', 'forbidden');

        $delete = $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'carol', 'destroy' => [$planId]], 'c2'],
        ], $this->token('viewer'))->assertOk();
        $delete->assertJsonPath('methodResponses.0.1.notDestroyed.'.$planId.'.type', 'forbidden');

        $this->listWorkspace('owner')
            ->assertOk()
            ->assertJsonFragment(['name' => 'plan.md', 'type' => 'file'])
            ->assertJsonMissing(['name' => 'viewer-dir']);
        $this->assertSame(self::PLAN_BODY, $this->readCollab(self::PLAN, 'owner')->assertOk()->getContent());
    }

    public function test_editor_can_create_folder_rename_and_delete_in_the_shared_folder(): void
    {
        $workspaceId = $this->workspaceNodeId();
        $planId = $this->planNodeId();

        $createdDir = $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'bob', 'create' => [
                'd0' => ['parentId' => $workspaceId, 'name' => 'editor-dir', 'nodeType' => 'directory'],
            ]], 'c0'],
        ], $this->token('editor'))->assertOk();
        $createdDir->assertJsonPath('methodResponses.0.1.created.d0.name', 'editor-dir');
        $dirId = (string) $createdDir->json('methodResponses.0.1.created.d0.id');

        $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'bob', 'update' => [
                $planId => ['name' => 'plan-renamed.md'],
            ]], 'c1'],
        ], $this->token('editor'))->assertOk()
            ->assertJsonPath('methodResponses.0.1.updated.'.$planId, null);

        $this->listWorkspace('editor')
            ->assertOk()
            ->assertJsonFragment(['name' => 'editor-dir', 'type' => 'dir'])
            ->assertJsonFragment(['name' => 'plan-renamed.md', 'type' => 'file'])
            ->assertJsonMissing(['name' => 'plan.md']);

        $deleted = $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'bob', 'destroy' => [$dirId, $planId]], 'c2'],
        ], $this->token('editor'))->assertOk();
        $this->assertEqualsCanonicalizing(
            [$dirId, $planId],
            $deleted->json('methodResponses.0.1.destroyed'),
        );

        $this->listWorkspace('owner')
            ->assertOk()
            ->assertJsonMissing(['name' => 'editor-dir'])
            ->assertJsonMissing(['name' => 'plan-renamed.md']);

        $this->withBearer($this->token('owner'))
            ->getJson('/api/v1/files/children?path='.urlencode(self::OWNER_TRASH))
            ->assertOk()
            ->assertJsonFragment(['name' => 'plan-renamed.md', 'type' => 'file'])
            ->assertJsonFragment(['name' => 'editor-dir', 'type' => 'dir']);

        $this->download(self::OWNER_TRASH.'/plan-renamed.md', 'editor')
            ->assertStatus(400)
            ->assertJsonPath('error', 'Access denied for this path.');
    }

    public function test_admin_cannot_read_another_users_private_files(): void
    {
        app(WgwStorage::class)->files()->put('users/bob/secret.md', 'bob-only');

        $ownerDownload = $this->download('/users/bob/secret.md', 'editor');
        $ownerDownload->assertOk();
        $this->assertSame('bob-only', $ownerDownload->streamedContent());

        $this->withBearer($this->token('owner'))
            ->getJson('/api/v1/files/children?path='.urlencode('/users/bob'))
            ->assertStatus(400)
            ->assertJsonPath('error', 'Access denied for this path.');

        $this->download('/users/bob/secret.md', 'owner')
            ->assertStatus(400)
            ->assertJsonPath('error', 'Access denied for this path.');
    }

    #[DataProvider('rightsProvider')]
    public function test_effective_rights_match_role(
        string $role,
        bool $mayEditContent,
        bool $mayManageStructure,
        bool $mayShare,
    ): void {
        $this->withBearer($this->token($role))
            ->getJson('/api/v1/files/shares/at-path?path='.urlencode(self::PLAN))
            ->assertOk()
            ->assertJsonPath('data.myRights.mayView', true)
            ->assertJsonPath('data.myRights.mayEditContent', $mayEditContent)
            ->assertJsonPath('data.myRights.mayManageStructure', $mayManageStructure)
            ->assertJsonPath('data.myRights.mayShare', $mayShare);
    }

    #[DataProvider('granteeProvider')]
    public function test_grantee_cannot_grant_change_or_revoke(string $role): void
    {
        $this->withBearer($this->token($role))->postJson('/api/v1/files/shares', [
            'path' => self::WORKSPACE,
            'kind' => 'member',
            'defaultAccess' => self::VIEWER_ACCESS,
            'shareWith' => ['carol' => ['access' => self::EDITOR_ACCESS]],
        ])->assertForbidden()
            ->assertJsonPath('code', 'forbidden')
            ->assertJsonPath('error', 'Cannot share this path.');

        // Load updatedAt before withBearer($role): that helper overwrites the default Authorization header.
        $updatedAt = $this->shareUpdatedAt();
        $this->withBearer($this->token($role))->patchJson('/api/v1/files/shares/'.$this->shareId, [
            'updatedAt' => $updatedAt,
            'shareWith' => ['carol' => ['access' => self::EDITOR_ACCESS]],
        ])->assertNotFound()
            ->assertJsonPath('code', 'not_found');

        $this->withBearer($this->token($role))->deleteJson('/api/v1/files/shares/'.$this->shareId)
            ->assertNotFound()
            ->assertJsonPath('code', 'not_found');

        $this->readCollab(self::PLAN, 'editor')->assertOk();
        $this->readCollab(self::PLAN, 'viewer')->assertOk();
    }

    public function test_owner_can_change_permissions_and_revoke(): void
    {
        $this->patchGrant('bob', ['access' => self::VIEWER_ACCESS]);
        $this->writeCollab(self::PLAN, 'editor', "blocked after downgrade\n")
            ->assertForbidden();

        $this->patchGrant('bob', ['access' => self::EDITOR_ACCESS]);
        $this->writeCollab(self::PLAN, 'editor', "restored editor\n")->assertOk();

        $this->withBearer($this->token('owner'))
            ->deleteJson('/api/v1/files/shares/'.$this->shareId)
            ->assertOk()
            ->assertJsonPath('data', 'Deleted');

        $this->assertRevoked('editor');
        $this->assertRevoked('viewer');
        $this->readCollab(self::PLAN, 'owner')->assertOk();
    }

    public function test_upgrade_viewer_to_editor_allows_writes_but_not_sharing(): void
    {
        $this->writeCollab(self::PLAN, 'viewer', "before upgrade\n")->assertForbidden();

        $this->patchGrant('carol', ['access' => self::EDITOR_ACCESS]);

        $this->withBearer($this->token('viewer'))
            ->getJson('/api/v1/files/shares/at-path?path='.urlencode(self::PLAN))
            ->assertOk()
            ->assertJsonPath('data.myRights.mayEditContent', true)
            ->assertJsonPath('data.myRights.mayManageStructure', true)
            ->assertJsonPath('data.myRights.mayShare', false);

        $this->writeCollab(self::PLAN, 'viewer', "after upgrade\n")->assertOk();
        $this->withBearer($this->token('viewer'))->postJson('/api/v1/files/shares', [
            'path' => self::WORKSPACE,
            'kind' => 'member',
            'defaultAccess' => self::VIEWER_ACCESS,
        ])->assertForbidden();
    }

    public function test_downgrade_editor_to_viewer_blocks_writes(): void
    {
        $this->writeCollab(self::PLAN, 'editor', 'while editor')->assertOk();

        $this->patchGrant('bob', ['access' => self::VIEWER_ACCESS]);

        $this->withBearer($this->token('editor'))
            ->getJson('/api/v1/files/shares/at-path?path='.urlencode(self::PLAN))
            ->assertOk()
            ->assertJsonPath('data.myRights.mayView', true)
            ->assertJsonPath('data.myRights.mayEditContent', false)
            ->assertJsonPath('data.myRights.mayManageStructure', false)
            ->assertJsonPath('data.myRights.mayShare', false);

        $this->writeCollab(self::PLAN, 'editor', "after downgrade\n")
            ->assertForbidden()
            ->assertJsonPath('error', 'forbidden');
        $this->assertSame('while editor', $this->readCollab(self::PLAN, 'editor')->assertOk()->getContent());
        $this->listWorkspace('editor')->assertOk()->assertJsonFragment(['name' => 'plan.md']);
    }

    public function test_removing_one_grant_denies_only_that_principal(): void
    {
        $this->patchGrant('carol', null);

        $this->assertRevoked('viewer');
        $this->writeCollab(self::PLAN, 'editor', "editor remains\n")->assertOk();
        $this->listWorkspace('editor')->assertOk()->assertJsonFragment(['name' => 'plan.md']);
    }

    public function test_deleting_the_share_denies_former_grantees(): void
    {
        $this->withBearer($this->token('owner'))
            ->deleteJson('/api/v1/files/shares/'.$this->shareId)
            ->assertOk();

        $this->assertRevoked('editor');
        $this->assertRevoked('viewer');
    }

    public function test_pending_email_invite_does_not_grant_access_until_accepted_then_revoked(): void
    {
        $this->seedDave();

        $invite = $this->withBearer($this->token('owner'))->postJson('/api/v1/files/shares/'.$this->shareId.'/invites', [
            'email' => 'dave@example.com',
            'access' => self::EDITOR_ACCESS,
        ])->assertOk();
        $inviteToken = (string) $invite->json('data.inviteToken');
        $this->assertNotSame('', $inviteToken);

        $this->assertRevoked('dave');

        $this->withBearer($this->token('dave'))->postJson('/api/v1/files/share-sessions/accept', [
            'inviteToken' => $inviteToken,
        ])->assertOk();

        $this->listWorkspace('dave')
            ->assertOk()
            ->assertJsonFragment(['name' => 'plan.md', 'type' => 'file']);
        $this->writeCollab(self::PLAN, 'dave', 'invited editor')->assertOk();
        $this->assertSame('invited editor', $this->readCollab(self::PLAN, 'dave')->assertOk()->getContent());
        $this->withBearer($this->token('dave'))->postJson('/api/v1/files/shares', [
            'path' => self::WORKSPACE,
            'kind' => 'member',
            'defaultAccess' => self::VIEWER_ACCESS,
        ])->assertForbidden();

        $this->patchGrant('dave', null);
        $this->assertRevoked('dave');
        $this->assertSame('invited editor', $this->readCollab(self::PLAN, 'owner')->assertOk()->getContent());
    }

    public function test_team_member_can_read_and_write_group_drive_and_non_member_is_denied(): void
    {
        $this->seedGroupFile('roster.md', 'team roster');

        $this->withBearer($this->token('editor'))
            ->getJson('/api/v1/files/children?path=/groups/team')
            ->assertOk()
            ->assertJsonFragment(['name' => 'roster.md', 'type' => 'file']);
        $memberDownload = $this->download('/groups/team/roster.md', 'editor');
        $memberDownload->assertOk();
        $this->assertSame('team roster', $memberDownload->streamedContent());
        $this->writeCollab('/groups/team/roster.md', 'editor', 'member write')->assertOk();
        $this->assertSame('member write', $this->readCollab('/groups/team/roster.md', 'owner')->assertOk()->getContent());

        $this->withBearer($this->token('viewer'))
            ->getJson('/api/v1/files/children?path=/groups/team')
            ->assertStatus(400)
            ->assertJsonPath('error', 'Access denied for this path.');
        $this->download('/groups/team/roster.md', 'viewer')
            ->assertStatus(400)
            ->assertJsonPath('error', 'Access denied for this path.');
        $this->writeCollab('/groups/team/roster.md', 'viewer', "non-member\n")
            ->assertForbidden()
            ->assertJsonPath('error', 'forbidden');
        $this->assertSame('member write', $this->readCollab('/groups/team/roster.md', 'editor')->assertOk()->getContent());
    }

    public function test_group_grant_applies_to_members_only(): void
    {
        $path = '/users/alice/group-share.md';
        app(WgwStorage::class)->files()->put('users/alice/group-share.md', 'group body');

        $this->withBearer($this->token('owner'))->postJson('/api/v1/files/shares', [
            'path' => $path,
            'kind' => 'member',
            'defaultAccess' => self::EDITOR_ACCESS,
            'shareWith' => ['groups/team' => ['access' => self::EDITOR_ACCESS]],
        ])->assertOk()
            ->assertJsonPath('data.shareWith.groups/team.access', self::EDITOR_ACCESS);

        $memberDownload = $this->download($path, 'editor');
        $memberDownload->assertOk();
        $this->assertSame('group body', $memberDownload->streamedContent());
        $this->writeCollab($path, 'editor', 'via group')->assertOk();
        $this->assertSame('via group', $this->readCollab($path, 'owner')->assertOk()->getContent());

        $this->download($path, 'viewer')
            ->assertStatus(400)
            ->assertJsonPath('error', 'Access denied for this path.');
        $this->readCollab($path, 'viewer')
            ->assertForbidden()
            ->assertJsonPath('error', 'forbidden');
        $this->writeCollab($path, 'viewer', "outside group\n")->assertForbidden();
        $this->assertSame('via group', $this->readCollab($path, 'owner')->assertOk()->getContent());
    }

    public function test_unrelated_user_is_denied_on_the_shared_path(): void
    {
        $this->seedDave();
        // REST denial only. FileNode/set notFound would be vacuous (#990 invisibility).
        $this->assertRevoked('dave');
    }

    public function test_owner_can_trash_and_restore_inside_the_share(): void
    {
        $this->seedDave();
        $planId = $this->planNodeId();
        $trashId = $this->ensureActorTrashNodeId('owner');

        $this->moveNode('owner', $planId, $trashId)->assertOk()
            ->assertJsonPath('methodResponses.0.1.updated.'.$planId, null);

        $this->listWorkspace('owner')
            ->assertOk()
            ->assertJsonMissing(['name' => 'plan.md'])
            ->assertJsonMissing(['name' => '.Trash']);
        $this->withBearer($this->token('owner'))
            ->getJson('/api/v1/files/children?path='.urlencode(self::OWNER_TRASH))
            ->assertOk()
            ->assertJsonFragment(['name' => 'plan.md', 'type' => 'file']);

        $ownerTrashed = $this->download(self::OWNER_TRASH.'/plan.md', 'owner');
        $ownerTrashed->assertOk();
        $this->assertSame(self::PLAN_BODY, $ownerTrashed->streamedContent());

        $this->download(self::OWNER_TRASH.'/plan.md', 'editor')
            ->assertStatus(400)
            ->assertJsonPath('error', 'Access denied for this path.');
        $this->download(self::OWNER_TRASH.'/plan.md', 'dave')
            ->assertStatus(400)
            ->assertJsonPath('error', 'Access denied for this path.');

        $this->moveNode('owner', $planId, $this->workspaceNodeId())->assertOk()
            ->assertJsonPath('methodResponses.0.1.updated.'.$planId, null);

        $this->listWorkspace('owner')
            ->assertOk()
            ->assertJsonFragment(['name' => 'plan.md', 'type' => 'file']);
        $this->assertSame(self::PLAN_BODY, $this->readCollab(self::PLAN, 'viewer')->assertOk()->getContent());
    }

    public function test_owner_can_move_a_file_out_of_the_share_to_their_tree(): void
    {
        $planId = $this->planNodeId();
        $homeId = $this->fileNodeIdByName(
            $this->fileNodeGetAll('alice', $this->token('owner')),
            'alice',
        );

        $this->moveNode('owner', $planId, $homeId)->assertOk()
            ->assertJsonPath('methodResponses.0.1.updated.'.$planId, null);

        $this->listWorkspace('owner')->assertOk()->assertJsonMissing(['name' => 'plan.md']);
        $moved = $this->download('/users/alice/plan.md', 'owner');
        $moved->assertOk();
        $this->assertSame(self::PLAN_BODY, $moved->streamedContent());

        $this->download(self::PLAN, 'editor')
            ->assertStatus(400)
            ->assertJsonPath('error', 'File not found.');
        $this->download('/users/alice/plan.md', 'editor')
            ->assertStatus(400)
            ->assertJsonPath('error', 'Access denied for this path.');
    }
}
