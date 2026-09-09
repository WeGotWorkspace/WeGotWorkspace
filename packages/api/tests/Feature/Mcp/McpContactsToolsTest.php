<?php

declare(strict_types=1);

namespace Tests\Feature\Mcp;

use App\Mcp\McpToolCatalog;
use App\Mcp\Servers\WorkspaceServer;
use App\Mcp\Tools\AddressBookListTool;
use App\Mcp\Tools\AddressBookShareTool;
use App\Mcp\Tools\AddressBookWriteTool;
use App\Mcp\Tools\ContactQueryTool;
use App\Mcp\Tools\ContactWriteTool;
use App\Models\Addressbook;
use App\Services\Contacts\AddressBookCollectionUris;
use App\Services\Contacts\ContactCardRepository;
use App\Services\Mcp\McpScopes;
use App\Support\WgwSettings;
use Laravel\Passport\Passport;
use Tests\Support\ConfiguresMcp;
use Tests\Support\ContactsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class McpContactsToolsTest extends WgwDatabaseTestCase
{
    use ConfiguresMcp;
    use ContactsTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpContactsFixtures();
        $this->enableMcp();
    }

    public function test_addressbook_list_and_contact_write_happy_path(): void
    {
        $user = $this->mcpUser('bob');
        $client = $this->mcpClient();
        Passport::actingAs($user, [McpScopes::CONTACTS_READ, McpScopes::CONTACTS_WRITE], 'api', $client);

        WorkspaceServer::actingAs($user, 'api')
            ->tool(AddressBookListTool::class)
            ->assertOk()
            ->assertSee(AddressBookCollectionUris::PERSONAL_DEFAULT);

        WorkspaceServer::actingAs($user, 'api')
            ->tool(AddressBookWriteTool::class, [
                'action' => 'update',
                'addressBookId' => AddressBookCollectionUris::PERSONAL_DEFAULT,
                'description' => 'Team directory',
            ])
            ->assertOk()
            ->assertSee('Team directory');

        WorkspaceServer::actingAs($user, 'api')
            ->tool(ContactWriteTool::class, [
                'action' => 'create',
                'addressBookIds' => [AddressBookCollectionUris::PERSONAL_DEFAULT => true],
                'kind' => 'individual',
                'name' => [
                    'full' => 'Ada Lovelace',
                    'components' => [
                        ['kind' => 'given', 'value' => 'Ada'],
                        ['kind' => 'surname', 'value' => 'Lovelace'],
                    ],
                ],
                'emails' => [
                    'e1' => ['address' => 'ada@example.com'],
                ],
                'phones' => [
                    'p1' => ['number' => '+1-555-0100'],
                ],
                'addresses' => [
                    'a1' => [
                        'components' => [
                            ['kind' => 'name', 'value' => '1 Analytical Engine Rd'],
                        ],
                    ],
                ],
                'organizations' => [
                    'o1' => ['name' => 'Royal Society'],
                ],
                'titles' => [
                    't1' => ['name' => 'Mathematician'],
                ],
                'anniversaries' => [
                    'bday' => [
                        'kind' => 'birth',
                        'date' => ['@type' => 'PartialDate', 'year' => 1815, 'month' => 12, 'day' => 10],
                    ],
                ],
                'notes' => [
                    'n1' => ['note' => 'Prefers written correspondence'],
                ],
                'links' => [
                    'w1' => ['uri' => 'https://example.com/ada'],
                ],
                'keywords' => ['pioneer' => true],
            ])
            ->assertOk()
            ->assertSee('Ada Lovelace')
            ->assertSee('ada@example.com');

        WorkspaceServer::actingAs($user, 'api')
            ->tool(ContactQueryTool::class, [
                'addressBookId' => AddressBookCollectionUris::PERSONAL_DEFAULT,
            ])
            ->assertOk()
            ->assertSee('Ada Lovelace');
    }

    public function test_addressbook_write_create_is_forbidden(): void
    {
        $user = $this->mcpUser('bob');
        $client = $this->mcpClient();
        Passport::actingAs($user, [McpScopes::CONTACTS_WRITE], 'api', $client);

        WorkspaceServer::actingAs($user, 'api')
            ->tool(AddressBookWriteTool::class, ['action' => 'create'])
            ->assertHasErrors(['Creating address books is not allowed.']);
    }

    public function test_contact_write_denies_read_scope(): void
    {
        $user = $this->mcpUser('bob');
        $client = $this->mcpClient();
        Passport::actingAs($user, [McpScopes::CONTACTS_READ], 'api', $client);

        WorkspaceServer::actingAs($user, 'api')
            ->tool(ContactWriteTool::class, [
                'action' => 'create',
                'addressBookIds' => [AddressBookCollectionUris::PERSONAL_DEFAULT => true],
                'name' => ['full' => 'Blocked'],
            ])
            ->assertHasErrors(['Missing OAuth scope: contacts.write']);
    }

    public function test_legacy_contacts_scope_can_write(): void
    {
        $user = $this->mcpUser('bob');
        $client = $this->mcpClient();
        Passport::actingAs($user, [McpScopes::CONTACTS], 'api', $client);

        WorkspaceServer::actingAs($user, 'api')
            ->tool(ContactWriteTool::class, [
                'action' => 'create',
                'addressBookIds' => [AddressBookCollectionUris::PERSONAL_DEFAULT => true],
                'name' => ['full' => 'Legacy Contact'],
            ])
            ->assertOk()
            ->assertSee('Legacy Contact');
    }

    public function test_contact_write_enforces_acl(): void
    {
        $bob = $this->mcpUser('bob');
        $carol = $this->mcpUser('carol');
        $client = $this->mcpClient();
        Passport::actingAs($bob, [McpScopes::CONTACTS_WRITE], 'api', $client);
        WorkspaceServer::actingAs($bob, 'api')
            ->tool(ContactWriteTool::class, [
                'action' => 'create',
                'addressBookIds' => [AddressBookCollectionUris::PERSONAL_DEFAULT => true],
                'name' => ['full' => 'Private Person'],
            ])
            ->assertOk();

        $listed = app(ContactCardRepository::class)
            ->list('bob', AddressBookCollectionUris::PERSONAL_DEFAULT);
        $contactId = (string) ($listed['list'][0]['id'] ?? '');
        $this->assertNotSame('', $contactId);

        Passport::actingAs($carol, [McpScopes::CONTACTS_WRITE], 'api', $client);
        WorkspaceServer::actingAs($carol, 'api')
            ->tool(ContactWriteTool::class, [
                'action' => 'update',
                'contactId' => $contactId,
                'name' => ['full' => 'Hijacked'],
            ])
            ->assertHasErrors(['Contact card not found']);
    }

    public function test_addressbook_share_round_trip_and_acl(): void
    {
        $bob = $this->mcpUser('bob');
        $this->mcpUser('alice');
        $carol = $this->mcpUser('carol');
        $client = $this->mcpClient();
        Passport::actingAs($bob, [McpScopes::CONTACTS_WRITE], 'api', $client);

        WorkspaceServer::actingAs($bob, 'api')
            ->tool(AddressBookShareTool::class, [
                'action' => 'set',
                'addressBookId' => AddressBookCollectionUris::PERSONAL_DEFAULT,
                'shareWith' => ['alice' => ['mayRead' => true]],
            ])
            ->assertOk()
            ->assertSee('alice');

        $bookId = (int) Addressbook::query()
            ->where('principaluri', 'principals/bob')
            ->value('id');
        $this->assertGreaterThan(0, $bookId);

        Passport::actingAs($carol, [McpScopes::CONTACTS_WRITE], 'api', $client);
        WorkspaceServer::actingAs($carol, 'api')
            ->tool(AddressBookShareTool::class, [
                'action' => 'set',
                'addressBookId' => AddressBookCollectionUris::sharedApiId($bookId),
                'shareWith' => ['bob' => ['mayRead' => true]],
            ])
            ->assertHasErrors(['Address book not found']);
    }

    public function test_catalog_hides_contacts_when_disabled(): void
    {
        $this->setAppSetting(WgwSettings::CONTACTS_ENABLED, false);
        $tools = app(McpToolCatalog::class)->enabledTools();
        $this->assertNotContains(ContactWriteTool::class, $tools);
        $this->assertNotContains(AddressBookListTool::class, $tools);
    }
}
