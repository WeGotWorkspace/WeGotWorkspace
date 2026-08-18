<?php

declare(strict_types=1);

namespace Tests\Feature\Contacts;

use Tests\Support\ContactsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class ContactsCardsSetTest extends WgwDatabaseTestCase
{
    use ContactsTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpContactsFixtures();
    }

    public function test_set_create_returns_server_id(): void
    {
        $response = $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/contacts/cards/set', [
                'create' => [
                    'new-1' => [
                        'addressBookIds' => ['default' => true],
                        'name' => ['full' => 'Set Created Contact'],
                    ],
                ],
            ]);

        $response->assertOk()
            ->assertJsonPath('created.new-1', fn ($id) => is_string($id) && $id !== '');

        $cardId = (string) $response->json('created.new-1');
        $show = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/contacts/cards/'.$cardId);
        $show->assertOk()
            ->assertJsonPath('name.full', 'Set Created Contact')
            ->assertJsonPath('state', fn ($state) => is_string($state) && $state !== '');
    }

    public function test_set_create_with_unknown_media_blob_id_keeps_the_legacy_invalid_blob_type(): void
    {
        // Regression: the wgw_data disk throws on missing files, which used
        // to turn an unknown media blobId into serverError instead of the
        // resolver's intended invalid_blob 400. REST keeps its legacy shape;
        // the envelope normalizes to invalidProperties (JmapContactsMethodsTest).
        $response = $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/contacts/cards/set', [
                'create' => [
                    'new-1' => [
                        'addressBookIds' => ['default' => true],
                        'name' => ['full' => 'Broken Photo'],
                        'media' => [
                            'm1' => ['kind' => 'photo', 'blobId' => 'ffffffff-ffff-ffff-ffff-ffffffffffff'],
                        ],
                    ],
                ],
            ]);

        $response->assertOk()
            ->assertJsonPath('notCreated.new-1.type', 'invalid_blob');
    }

    public function test_set_update_with_if_in_state(): void
    {
        $create = $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/contacts/cards', [
                'addressBookIds' => ['default' => true],
                'name' => ['full' => 'Before Set Update'],
            ]);
        $create->assertCreated();
        $cardId = (string) $create->json('id');
        $state = (string) $create->json('state');
        $this->assertNotSame('', $state);

        $set = $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/contacts/cards/set', [
                'update' => [
                    $cardId => [
                        'ifInState' => $state,
                        'name' => ['full' => 'After Set Update'],
                    ],
                ],
            ]);

        $set->assertOk()
            ->assertJsonPath('updated.'.$cardId, fn ($next) => is_string($next) && $next !== '' && $next !== $state);

        $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/contacts/cards/'.$cardId)
            ->assertOk()
            ->assertJsonPath('name.full', 'After Set Update');
    }

    public function test_set_update_state_mismatch(): void
    {
        $create = $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/contacts/cards', [
                'addressBookIds' => ['default' => true],
                'name' => ['full' => 'Mismatch Contact'],
            ]);
        $create->assertCreated();
        $cardId = (string) $create->json('id');

        $set = $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/contacts/cards/set', [
                'update' => [
                    $cardId => [
                        'ifInState' => 'stale-token',
                        'name' => ['full' => 'Should Not Apply'],
                    ],
                ],
            ]);

        $set->assertOk()
            ->assertJsonPath('notUpdated.'.$cardId.'.type', 'stateMismatch');
    }

    public function test_set_destroy_with_if_in_state(): void
    {
        $create = $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/contacts/cards', [
                'addressBookIds' => ['default' => true],
                'name' => ['full' => 'Delete Via Set'],
            ]);
        $create->assertCreated();
        $cardId = (string) $create->json('id');
        $state = (string) $create->json('state');

        $set = $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/contacts/cards/set', [
                'destroy' => [
                    $cardId => ['ifInState' => $state],
                ],
            ]);

        $set->assertOk()
            ->assertJsonPath('destroyed', [$cardId]);

        $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/contacts/cards/'.$cardId)
            ->assertNotFound();
    }
}
