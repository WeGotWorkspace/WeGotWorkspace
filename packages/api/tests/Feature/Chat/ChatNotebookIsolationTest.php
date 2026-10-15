<?php

declare(strict_types=1);

namespace Tests\Feature\Chat;

use Tests\Support\SeedsWgwIdentity;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Chat channels and notebooks are both VJOURNAL-only CalDAV collections.
 * The stored CollectionKind is the discriminator — a sharee instance does not
 * carry the owner's uri. These regressions pin both directions: notebook
 * queries must never pick up chat collections and chat queries must never
 * pick up notebooks.
 */
final class ChatNotebookIsolationTest extends WgwDatabaseTestCase
{
    use SeedsWgwIdentity;

    protected function setUp(): void
    {
        parent::setUp();
        $this->configureWgwJwtKeys();
        $this->seedWgwUser('alice', displayName: 'Alice');
        $this->seedWgwUser('bob', displayName: 'Bob');
    }

    public function test_chat_channels_never_surface_as_notebooks(): void
    {
        $channelId = (string) $this->asUser('alice')->postJson('/api/v1/chat/channels', [
            'name' => 'General', 'kind' => 'channel',
        ])->assertCreated()->json('id');

        $notebookIds = array_column(
            $this->asUser('alice')->getJson('/api/v1/notes/notebooks')->assertOk()->json('list'),
            'id',
        );
        $this->assertNotContains($channelId, $notebookIds);

        $this->asUser('alice')->getJson('/api/v1/notes/notebooks/'.$channelId)->assertNotFound();
        $this->asUser('alice')->postJson('/api/v1/notes/items', [
            'notebookId' => $channelId,
            'title' => 'Sneaky note',
            'body' => 'x',
        ])->assertNotFound();
    }

    public function test_shared_chat_channel_never_surfaces_in_sharee_notebooks(): void
    {
        // Sabre mints a random UUID uri for sharee instances; chat re-points
        // them at the owner's chat- uri. Without that normalization this
        // shared channel would land in bob's notebook list.
        $channelId = (string) $this->asUser('alice')->postJson('/api/v1/chat/channels', [
            'name' => 'Team', 'kind' => 'channel',
        ])->assertCreated()->json('id');
        $this->asUser('alice')->patchJson('/api/v1/chat/channels/'.$channelId, [
            'shareWith' => ['bob' => ['mayWriteAll' => true]],
        ])->assertOk();

        $this->asUser('bob')->getJson('/api/v1/chat/channels/'.$channelId)->assertOk();

        $notebooks = $this->asUser('bob')->getJson('/api/v1/notes/notebooks')->assertOk()->json('list');
        foreach ($notebooks as $notebook) {
            $this->assertNotSame($channelId, $notebook['id']);
            $this->assertNotSame('Team', $notebook['name']);
        }
    }

    public function test_notebooks_never_surface_as_chat_channels(): void
    {
        $notebookId = (string) $this->asUser('alice')->postJson('/api/v1/notes/notebooks', [
            'name' => 'Journal',
        ])->assertCreated()->json('id');

        $channelIds = array_column(
            $this->asUser('alice')->getJson('/api/v1/chat/channels')->assertOk()->json('list'),
            'id',
        );
        $this->assertNotContains($notebookId, $channelIds);
        $this->assertNotContains('notes-general', $channelIds);

        $this->asUser('alice')->getJson('/api/v1/chat/channels/'.$notebookId)->assertNotFound();
        $this->asUser('alice')->getJson('/api/v1/chat/channels/notes-general')->assertNotFound();
    }

    public function test_notebook_ids_collide_with_any_existing_collection_uri(): void
    {
        $this->asUser('alice')->postJson('/api/v1/notes/notebooks', [
            'name' => 'Not a channel', 'id' => 'chat-evil',
        ])->assertStatus(409)->assertJsonPath('error', 'This notebook id is reserved for chat channels.');
        $this->asUser('alice')->postJson('/api/v1/notes/notebooks', [
            'name' => 'Not a DM', 'id' => 'dm-evil',
        ])->assertStatus(409)->assertJsonPath('error', 'This notebook id is reserved for chat channels.');

        $channelId = (string) $this->asUser('alice')->postJson('/api/v1/chat/channels', [
            'name' => 'Real', 'kind' => 'channel',
        ])->assertCreated()->json('id');
        $this->asUser('alice')->postJson('/api/v1/notes/notebooks', [
            'name' => 'Squat', 'id' => $channelId,
        ])->assertStatus(409);

        $slug = (string) $this->asUser('alice')->postJson('/api/v1/notes/notebooks', [
            'name' => 'chat-adjacent notes',
        ])->assertCreated()->json('id');
        $this->assertSame('notebook-chat-adjacent-notes', $slug);

        $docsSlug = (string) $this->asUser('alice')->postJson('/api/v1/notes/notebooks', [
            'name' => 'Docs threads',
        ])->assertCreated()->json('id');
        $this->assertSame('notebook-docs-threads', $docsSlug);
    }

    public function test_shared_notebook_resolves_by_kind_through_its_sharee_uri(): void
    {
        $notebookId = (string) $this->asUser('alice')->postJson('/api/v1/notes/notebooks', [
            'name' => 'Shared journal',
        ])->assertCreated()->json('id');
        $this->asUser('alice')->patchJson('/api/v1/notes/notebooks/'.$notebookId, [
            'shareWith' => ['bob' => ['mayWriteAll' => true]],
        ])->assertOk();

        $shared = collect($this->asUser('bob')->getJson('/api/v1/notes/notebooks')->assertOk()->json('list'))
            ->first(fn (array $row): bool => ($row['name'] ?? '') === 'Shared journal');
        $this->assertIsArray($shared);
        $this->assertNotSame($notebookId, $shared['id']);
    }

    private function asUser(string $username)
    {
        return $this->withBearer($this->issueBearerTokenFor($username));
    }
}
