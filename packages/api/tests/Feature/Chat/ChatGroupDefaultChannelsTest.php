<?php

declare(strict_types=1);

namespace Tests\Feature\Chat;

use App\Models\CalendarInstance;
use App\Models\ChatChannelMeta;
use App\Models\Principal;
use App\Services\Admin\AdminGroupManagementService;
use App\Services\Chat\ChatCollectionUris;
use App\Services\Chat\ChatGroupDefaultChannelProvisioner;
use App\Services\Jmap\JmapCapabilities;
use Illuminate\Testing\TestResponse;
use Tests\Support\SeedsWgwIdentity;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Every ACL group gets one default chat channel (Epic #701 chunk M).
 *
 * Provisioning is lazy ensure-on-read (any channel read by a member) plus an
 * eager hook on admin group creation. The channel is owned by the group
 * principal — membership follows group membership with no share invites — and
 * is immutable through the generic channel endpoints, like DMs.
 */
final class ChatGroupDefaultChannelsTest extends WgwDatabaseTestCase
{
    use SeedsWgwIdentity;

    private const ULID = '01J6Y6M0R2V9GKJ4W1T8Q3ZBAA';

    protected function setUp(): void
    {
        parent::setUp();
        $this->configureWgwJwtKeys();
        $this->seedWgwUser('alice', displayName: 'Alice');
        $this->seedWgwUser('bob', displayName: 'Bob');
        $this->seedWgwUser('carol', displayName: 'Carol');
    }

    public function test_listing_provisions_one_default_channel_per_group(): void
    {
        $this->seedGroupWithMembers('devs', 'Developers', ['alice', 'bob']);
        $this->seedGroupWithMembers('ops', 'Operations', ['alice']);

        $list = $this->asUser('alice')->getJson('/api/v1/chat/channels')->assertOk()->json('list');
        $this->assertCount(2, $list);

        $devs = collect($list)->firstWhere('id', ChatCollectionUris::groupDefaultUri('devs'));
        $this->assertNotNull($devs);
        $this->assertSame('Developers', $devs['name']);
        $this->assertSame('channel', $devs['kind']);
        $this->assertSame('group', $devs['scope']);
        $this->assertSame('devs', $devs['groupSlug']);
        $this->assertTrue($devs['isDefault']);
        $this->assertFalse($devs['isSharee']);
        $this->assertSame(2, $devs['memberCount']);
        // Immutability surfaces in the rights (clients hide the affordances).
        $this->assertTrue($devs['myRights']['mayWriteAll']);
        $this->assertFalse($devs['myRights']['mayShare']);
        $this->assertFalse($devs['myRights']['mayDelete']);

        // The `chat-` prefix puts default channels behind the DAV-exposure
        // filter like every chat collection (ChatCollectionsDavExposureTest
        // proves the prefix-based hiding end-to-end).
        $this->assertStringStartsWith('chat-', (string) $devs['id']);
        $this->assertTrue(ChatCollectionUris::isChatUri((string) $devs['id']));

        // Repeat listing is idempotent — still exactly one channel per group.
        $again = $this->asUser('alice')->getJson('/api/v1/chat/channels')->assertOk()->json('list');
        $this->assertCount(2, $again);
        $this->assertSame(
            1,
            CalendarInstance::query()->where('uri', ChatCollectionUris::groupDefaultUri('devs'))->count(),
        );

        // Fellow member addresses the same channel id directly; bob is not in
        // ops, so ops' default stays invisible to him.
        $this->asUser('bob')->getJson('/api/v1/chat/channels/'.$devs['id'])->assertOk()
            ->assertJsonPath('isDefault', true);
        $this->assertCount(1, $this->asUser('bob')->getJson('/api/v1/chat/channels')->assertOk()->json('list'));

        // Non-member: nothing provisioned into view, direct access 404.
        $this->assertSame([], $this->asUser('carol')->getJson('/api/v1/chat/channels')->assertOk()->json('list'));
        $this->asUser('carol')->getJson('/api/v1/chat/channels/'.$devs['id'])->assertNotFound();
    }

    public function test_jmap_channel_get_provisions_and_mirrors_the_rest_shape(): void
    {
        $this->seedGroupWithMembers('devs', 'Developers', ['alice']);

        $args = $this->jmap('alice', [
            ['ChatChannel/get', ['accountId' => 'alice', 'ids' => null], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');

        $channel = collect($args['list'])->firstWhere('id', ChatCollectionUris::groupDefaultUri('devs'));
        $this->assertNotNull($channel);
        $this->assertSame('Developers', $channel['name']);
        $this->assertTrue($channel['isDefault']);
        $this->assertSame('devs', $channel['groupSlug']);
    }

    public function test_new_group_membership_surfaces_on_the_changes_feed(): void
    {
        $initial = $this->asUser('alice')->getJson('/api/v1/chat/channels/changes')->assertOk()->json();

        $this->seedGroupWithMembers('devs', 'Developers', ['alice']);

        $delta = $this->asUser('alice')
            ->getJson('/api/v1/chat/channels/changes?since='.urlencode($initial['newState']))
            ->assertOk()->json();
        $this->assertContains(ChatCollectionUris::groupDefaultUri('devs'), $delta['created']);
    }

    public function test_provisioning_is_idempotent_and_respects_a_squatted_uri(): void
    {
        $this->seedGroupWithMembers('devs', 'Developers', ['alice']);
        $uri = ChatCollectionUris::groupDefaultUri('devs');

        $provisioner = app(ChatGroupDefaultChannelProvisioner::class);
        $provisioner->ensureForGroupSlugs(['devs']);
        $provisioner->ensureForGroupSlugs(['devs']);

        $this->assertSame(1, CalendarInstance::query()->where('uri', $uri)->count());
        $this->assertSame(1, ChatChannelMeta::query()->where('default_for_group', 'devs')->count());

        // A deterministic uri claimed via the client-supplied-id create path
        // BEFORE the group default ever provisioned: channel ids are globally
        // unique, so the provisioner must skip — never hijack or delete the
        // squatter's channel (documented edge; the group then has no default).
        $this->seedGroupWithMembers('ops', 'Operations', ['alice']);
        $squattedUri = ChatCollectionUris::groupDefaultUri('ops');
        $this->asUser('carol')->postJson('/api/v1/chat/channels', [
            'name' => 'Squatted', 'kind' => 'channel', 'id' => $squattedUri,
        ])->assertCreated();

        $list = $this->asUser('alice')->getJson('/api/v1/chat/channels')->assertOk()->json('list');
        $opsDefault = collect($list)->firstWhere('id', $squattedUri);
        $this->assertNull($opsDefault);
        $this->assertSame(1, CalendarInstance::query()->where('uri', $squattedUri)->count());
        $this->asUser('carol')->getJson('/api/v1/chat/channels/'.$squattedUri)->assertOk()
            ->assertJsonPath('isDefault', false)
            ->assertJsonPath('name', 'Squatted');
    }

    public function test_admin_group_creation_provisions_eagerly(): void
    {
        app(AdminGroupManagementService::class)->create('design', 'Design Team');

        $uri = ChatCollectionUris::groupDefaultUri('design');
        $instance = CalendarInstance::query()->where('uri', $uri)->first();
        $this->assertNotNull($instance);
        $this->assertSame('principals/groups/design', (string) $instance->principaluri);
        $this->assertSame('Design Team', (string) $instance->displayname);
        $this->assertSame(
            'design',
            (string) ChatChannelMeta::query()->find((int) $instance->calendarid)?->default_for_group,
        );
    }

    public function test_member_can_post_while_non_member_is_kept_out_and_must_knock(): void
    {
        $this->seedGroupWithMembers('devs', 'Developers', ['alice', 'bob']);
        $channelId = ChatCollectionUris::groupDefaultUri('devs');

        // Reading the list provisions; then any member posts through the
        // normal message surface.
        $this->asUser('alice')->getJson('/api/v1/chat/channels')->assertOk();
        $this->asUser('bob')->postJson('/api/v1/chat/channels/'.$channelId.'/messages', [
            'id' => self::ULID, 'body' => 'hello team',
        ])->assertCreated();

        // Non-member cannot address the channel at all.
        $this->asUser('carol')->postJson('/api/v1/chat/channels/'.$channelId.'/messages', [
            'id' => self::ULID, 'body' => 'intrusion',
        ])->assertNotFound();

        // Room = channel id: members join calls directly, non-members are
        // forced onto the knock path server-side (MeetChannelJoinPolicy).
        $this->asUser('alice')->postJson('/api/v1/rooms/'.$channelId.'/participants', [
            'peerId' => 'peer-alice', 'name' => 'Alice',
        ])->assertOk();
        $this->asUser('carol')->postJson('/api/v1/rooms/'.$channelId.'/participants', [
            'peerId' => 'peer-carol', 'name' => 'Carol',
        ])->assertStatus(403)->assertJsonPath('error', 'knock_required');
    }

    public function test_default_channels_are_immutable_like_dms(): void
    {
        $this->seedGroupWithMembers('devs', 'Developers', ['alice']);
        $this->asUser('alice')->getJson('/api/v1/chat/channels')->assertOk();
        $channelId = ChatCollectionUris::groupDefaultUri('devs');

        foreach ([
            ['name' => 'Renamed'],
            ['color' => '#ff0000'],
            ['topic' => 'new topic'],
            ['shareWith' => ['carol' => ['mayWriteAll' => true]]],
            ['groupSlug' => null],
        ] as $payload) {
            $this->asUser('alice')->patchJson('/api/v1/chat/channels/'.$channelId, $payload)
                ->assertForbidden();
        }
        $this->asUser('alice')->deleteJson('/api/v1/chat/channels/'.$channelId)->assertForbidden();

        // Still there, untouched.
        $this->asUser('alice')->getJson('/api/v1/chat/channels/'.$channelId)->assertOk()
            ->assertJsonPath('name', 'Developers');
    }

    public function test_group_rename_resyncs_the_channel_name_and_surfaces_as_updated(): void
    {
        $this->seedGroupWithMembers('devs', 'Developers', ['alice']);
        $this->asUser('alice')->getJson('/api/v1/chat/channels')->assertOk();
        $state = (string) $this->asUser('alice')->getJson('/api/v1/chat/channels/changes')
            ->assertOk()->json('newState');

        Principal::query()->where('uri', 'principals/groups/devs')
            ->update(['displayname' => 'Developer Guild']);

        // Renames go through the Sabre backend, so the synctoken bumps and the
        // change rides the normal feed.
        $channelId = ChatCollectionUris::groupDefaultUri('devs');
        $this->asUser('alice')->getJson('/api/v1/chat/channels/'.$channelId)->assertOk();
        $list = $this->asUser('alice')->getJson('/api/v1/chat/channels')->assertOk()->json('list');
        $this->assertSame('Developer Guild', collect($list)->firstWhere('id', $channelId)['name']);

        $delta = $this->asUser('alice')
            ->getJson('/api/v1/chat/channels/changes?since='.urlencode($state))
            ->assertOk()->json();
        $this->assertContains($channelId, $delta['updated']);
    }

    /**
     * @param  list<string>  $members
     */
    private function seedGroupWithMembers(string $slug, string $displayName, array $members): void
    {
        $group = $this->seedWgwGroup('principals/groups/'.$slug, $displayName);
        foreach ($members as $member) {
            $principal = Principal::query()->where('uri', 'principals/'.$member)->firstOrFail();
            $this->addPrincipalToGroup($group, $principal);
        }
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $methodCalls
     */
    private function jmap(string $username, array $methodCalls): TestResponse
    {
        return $this->asUser($username)->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::CHAT],
            'methodCalls' => $methodCalls,
        ]);
    }

    private function asUser(string $username): self
    {
        return $this->withBearer($this->issueBearerTokenFor($username));
    }
}
