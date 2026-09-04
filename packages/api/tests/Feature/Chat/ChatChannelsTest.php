<?php

declare(strict_types=1);

namespace Tests\Feature\Chat;

use App\Models\Principal;
use Tests\Support\SeedsWgwIdentity;
use Tests\Support\WgwDatabaseTestCase;

final class ChatChannelsTest extends WgwDatabaseTestCase
{
    use SeedsWgwIdentity;

    protected function setUp(): void
    {
        parent::setUp();
        $this->configureWgwJwtKeys();
        $this->seedWgwUser('alice', displayName: 'Alice');
        $this->seedWgwUser('bob', displayName: 'Bob');
        $this->seedWgwUser('carol', displayName: 'Carol');
    }

    public function test_owner_channel_crud_round_trip(): void
    {
        $created = $this->asUser('alice')->postJson('/api/v1/chat/channels', [
            'name' => 'General',
            'kind' => 'channel',
            'topic' => 'Everything else',
            'color' => '#336699',
        ])->assertCreated()->json();

        $this->assertStringStartsWith('chat-', $created['id']);
        $this->assertSame('General', $created['name']);
        $this->assertSame('channel', $created['kind']);
        $this->assertSame('Everything else', $created['topic']);
        $this->assertSame('personal', $created['scope']);
        $this->assertNull($created['groupSlug']);
        $this->assertFalse($created['isSharee']);
        $this->assertTrue($created['myRights']['mayWriteAll']);
        $this->assertTrue($created['myRights']['mayShare']);
        $this->assertSame(1, $created['memberCount']);

        $list = $this->asUser('alice')->getJson('/api/v1/chat/channels')->assertOk()->json('list');
        $this->assertCount(1, $list);
        $this->assertSame($created['id'], $list[0]['id']);

        $this->asUser('alice')->patchJson('/api/v1/chat/channels/'.$created['id'], [
            'name' => 'General chat',
            'topic' => null,
        ])->assertOk()
            ->assertJsonPath('name', 'General chat')
            ->assertJsonPath('topic', null);

        $this->asUser('alice')->deleteJson('/api/v1/chat/channels/'.$created['id'])
            ->assertOk()->assertJsonPath('ok', true);
        $this->asUser('alice')->getJson('/api/v1/chat/channels/'.$created['id'])->assertNotFound();
        $this->assertSame([], $this->asUser('alice')->getJson('/api/v1/chat/channels')->json('list'));
    }

    public function test_kind_meeting_persists_and_guest_room_code_starts_null(): void
    {
        $created = $this->asUser('alice')->postJson('/api/v1/chat/channels', [
            'name' => 'Standup',
            'kind' => 'meeting',
        ])->assertCreated()->json();

        $this->assertSame('meeting', $created['kind']);
        $this->assertNull($created['guestRoomCode']);

        $shown = $this->asUser('alice')->getJson('/api/v1/chat/channels/'.$created['id'])->assertOk()->json();
        $this->assertSame('meeting', $shown['kind']);
    }

    public function test_client_supplied_id_is_validated_and_conflicts_are_409(): void
    {
        $this->asUser('alice')->postJson('/api/v1/chat/channels', [
            'name' => 'General', 'kind' => 'channel', 'id' => 'chat-general',
        ])->assertCreated()->assertJsonPath('id', 'chat-general');

        // Globally unique: bob cannot claim the same id for his own channel.
        $this->asUser('bob')->postJson('/api/v1/chat/channels', [
            'name' => 'Mine', 'kind' => 'channel', 'id' => 'chat-general',
        ])->assertStatus(409);

        $this->asUser('alice')->postJson('/api/v1/chat/channels', [
            'name' => 'Bad', 'kind' => 'channel', 'id' => 'unprefixed',
        ])->assertStatus(400);

        $this->asUser('alice')->postJson('/api/v1/chat/channels', [
            'name' => 'Bad dm', 'kind' => 'dm', 'id' => 'chat-not-a-dm',
        ])->assertStatus(400);
    }

    public function test_share_matrix_owner_sharee_and_non_member(): void
    {
        $channelId = (string) $this->asUser('alice')->postJson('/api/v1/chat/channels', [
            'name' => 'Team', 'kind' => 'channel',
        ])->assertCreated()->json('id');

        $this->asUser('alice')->patchJson('/api/v1/chat/channels/'.$channelId, [
            'shareWith' => ['bob' => ['mayWriteAll' => true]],
        ])->assertOk();

        // The sharee addresses the channel under the SAME id as the owner.
        $shared = $this->asUser('bob')->getJson('/api/v1/chat/channels/'.$channelId)->assertOk()->json();
        $this->assertTrue($shared['isSharee']);
        $this->assertNull($shared['shareWith']);
        $this->assertTrue($shared['myRights']['mayWriteAll']);
        $this->assertFalse($shared['myRights']['mayShare']);
        $this->assertSame(2, $shared['memberCount']);

        $ownerView = $this->asUser('alice')->getJson('/api/v1/chat/channels/'.$channelId)->assertOk()->json();
        $this->assertSame(['bob'], array_keys($ownerView['shareWith']));
        $this->assertSame(2, $ownerView['memberCount']);

        // Sharees rename their own instance but cannot touch shared state.
        $this->asUser('bob')->patchJson('/api/v1/chat/channels/'.$channelId, ['name' => 'Team (bob)'])->assertOk();
        $this->asUser('bob')->patchJson('/api/v1/chat/channels/'.$channelId, ['topic' => 'hijack'])->assertForbidden();
        $this->asUser('bob')->patchJson('/api/v1/chat/channels/'.$channelId, [
            'shareWith' => ['carol' => ['mayWriteAll' => true]],
        ])->assertForbidden();
        $this->asUser('bob')->patchJson('/api/v1/chat/channels/'.$channelId, ['groupSlug' => 'anything'])->assertForbidden();

        // Non-member: invisible.
        $this->asUser('carol')->getJson('/api/v1/chat/channels/'.$channelId)->assertNotFound();
        $this->asUser('carol')->patchJson('/api/v1/chat/channels/'.$channelId, ['name' => 'x'])->assertNotFound();
        $this->asUser('carol')->deleteJson('/api/v1/chat/channels/'.$channelId)->assertNotFound();

        // Revoke: bob loses the channel.
        $this->asUser('alice')->patchJson('/api/v1/chat/channels/'.$channelId, [
            'shareWith' => ['bob' => null],
        ])->assertOk();
        $this->asUser('bob')->getJson('/api/v1/chat/channels/'.$channelId)->assertNotFound();
    }

    public function test_read_only_sharee_rights(): void
    {
        $channelId = (string) $this->asUser('alice')->postJson('/api/v1/chat/channels', [
            'name' => 'Announcements', 'kind' => 'channel',
        ])->assertCreated()->json('id');
        $this->asUser('alice')->patchJson('/api/v1/chat/channels/'.$channelId, [
            'shareWith' => ['bob' => ['mayReadItems' => true]],
        ])->assertOk();

        $shared = $this->asUser('bob')->getJson('/api/v1/chat/channels/'.$channelId)->assertOk()->json();
        $this->assertTrue($shared['isSharee']);
        $this->assertFalse($shared['myRights']['mayWriteAll']);
        $this->assertTrue($shared['myRights']['mayReadItems']);
    }

    public function test_sharee_delete_dismisses_but_channel_survives_for_owner(): void
    {
        $channelId = (string) $this->asUser('alice')->postJson('/api/v1/chat/channels', [
            'name' => 'Team', 'kind' => 'channel',
        ])->assertCreated()->json('id');
        $this->asUser('alice')->patchJson('/api/v1/chat/channels/'.$channelId, [
            'shareWith' => ['bob' => ['mayWriteAll' => true]],
        ])->assertOk();

        $this->asUser('bob')->deleteJson('/api/v1/chat/channels/'.$channelId)
            ->assertOk()->assertJsonPath('ok', true);

        // Dismissal hides it from the sharee everywhere…
        $this->asUser('bob')->getJson('/api/v1/chat/channels/'.$channelId)->assertNotFound();
        $this->assertSame([], $this->asUser('bob')->getJson('/api/v1/chat/channels')->json('list'));

        // …while the owner keeps the channel and the grant.
        $this->asUser('alice')->getJson('/api/v1/chat/channels/'.$channelId)->assertOk();
    }

    public function test_group_owned_channels_and_group_slug_transfer(): void
    {
        $group = $this->seedWgwGroup('principals/groups/devs', 'Devs');
        $alice = Principal::query()->where('uri', 'principals/alice')->firstOrFail();
        $bob = Principal::query()->where('uri', 'principals/bob')->firstOrFail();
        $this->addPrincipalToGroup($group, $alice);
        $this->addPrincipalToGroup($group, $bob);

        // carol is not a member: create into the group is forbidden.
        $this->asUser('carol')->postJson('/api/v1/chat/channels', [
            'name' => 'Dev talk', 'kind' => 'channel', 'groupSlug' => 'devs',
        ])->assertForbidden();

        $created = $this->asUser('alice')->postJson('/api/v1/chat/channels', [
            'name' => 'Dev talk', 'kind' => 'channel', 'groupSlug' => 'devs',
        ])->assertCreated()->json();
        $this->assertSame('group', $created['scope']);
        $this->assertSame('devs', $created['groupSlug']);
        $this->assertSame(2, $created['memberCount']);

        // Fellow group member sees and may administer it; outsiders 404.
        $this->asUser('bob')->getJson('/api/v1/chat/channels/'.$created['id'])->assertOk()
            ->assertJsonPath('groupSlug', 'devs');
        $this->asUser('carol')->getJson('/api/v1/chat/channels/'.$created['id'])->assertNotFound();

        // Transfer group → personal, then personal → group.
        $this->asUser('bob')->patchJson('/api/v1/chat/channels/'.$created['id'], ['groupSlug' => null])
            ->assertOk()
            ->assertJsonPath('scope', 'personal')
            ->assertJsonPath('groupSlug', null);
        $this->asUser('bob')->patchJson('/api/v1/chat/channels/'.$created['id'], ['groupSlug' => 'devs'])
            ->assertOk()
            ->assertJsonPath('scope', 'group')
            ->assertJsonPath('groupSlug', 'devs');

        // Transfer into a group the caller does not belong to is forbidden.
        $personal = (string) $this->asUser('carol')->postJson('/api/v1/chat/channels', [
            'name' => 'Solo', 'kind' => 'channel',
        ])->assertCreated()->json('id');
        $this->asUser('carol')->patchJson('/api/v1/chat/channels/'.$personal, ['groupSlug' => 'devs'])
            ->assertForbidden();
    }

    public function test_channel_changes_track_create_update_delete(): void
    {
        $initial = $this->asUser('alice')->getJson('/api/v1/chat/channels/changes')->assertOk()->json();
        $this->assertSame('0', $initial['oldState']);
        $this->assertSame([], $initial['created']);

        $channelId = (string) $this->asUser('alice')->postJson('/api/v1/chat/channels', [
            'name' => 'Feed', 'kind' => 'channel',
        ])->assertCreated()->json('id');

        $afterCreate = $this->asUser('alice')->getJson('/api/v1/chat/channels/changes?since='.urlencode($initial['newState']))
            ->assertOk()->json();
        $this->assertSame([$channelId], $afterCreate['created']);

        $this->asUser('alice')->deleteJson('/api/v1/chat/channels/'.$channelId)->assertOk();
        $afterDelete = $this->asUser('alice')->getJson('/api/v1/chat/channels/changes?since='.urlencode($afterCreate['newState']))
            ->assertOk()->json();
        $this->assertSame([$channelId], $afterDelete['destroyed']);

        $this->asUser('alice')->getJson('/api/v1/chat/channels/changes?since=garbage')->assertStatus(400);
    }

    private function asUser(string $username)
    {
        return $this->withBearer($this->issueBearerTokenFor($username));
    }
}
