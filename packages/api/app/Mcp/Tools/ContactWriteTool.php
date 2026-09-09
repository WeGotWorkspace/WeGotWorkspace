<?php

declare(strict_types=1);

namespace App\Mcp\Tools;

use App\Services\Auth\AdminRoleResolver;
use App\Services\Contacts\ContactCardRepository;
use App\Services\Mcp\McpAuditLogger;
use App\Services\Mcp\McpScopes;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Tools\Annotations\IsDestructive;

#[IsDestructive]
final class ContactWriteTool extends WgwMcpTool
{
    protected string $name = 'contact_write';

    protected string $description = 'Create, update, or delete a contact (JSContact name, emails, phones, addresses, org, title, anniversary, notes, links, keywords).';

    /** @var list<string> */
    private const MAP_FIELDS = [
        'name',
        'nicknames',
        'emails',
        'phones',
        'addresses',
        'organizations',
        'titles',
        'anniversaries',
        'notes',
        'links',
        'keywords',
        'addressBookIds',
    ];

    /** @var list<string> */
    private const SUBSET = [
        'id',
        'addressBookIds',
        'kind',
        'name',
        'nicknames',
        'emails',
        'phones',
        'addresses',
        'organizations',
        'titles',
        'anniversaries',
        'notes',
        'links',
        'keywords',
    ];

    public function __construct(
        McpAuditLogger $audit,
        AdminRoleResolver $adminRoles,
        private ContactCardRepository $cards,
    ) {
        parent::__construct($audit, $adminRoles);
    }

    public function schema(JsonSchema $schema): array
    {
        return [
            'action' => $schema->string()->enum(['create', 'update', 'delete'])->required()
                ->description('create, update, or delete'),
            'contactId' => $schema->string()->description('Contact id (required for update and delete)'),
            'addressBookIds' => $schema->object()->description('Address book map {id: true} (required for create)'),
            'kind' => $schema->string()->description('JSContact kind (individual, group, org, …)'),
            'name' => $schema->object()->description('JSContact name (full + components)'),
            'nicknames' => $schema->object()->description('JSContact nicknames map'),
            'emails' => $schema->object()->description('JSContact emails map'),
            'phones' => $schema->object()->description('JSContact phones map'),
            'addresses' => $schema->object()->description('JSContact addresses map'),
            'organizations' => $schema->object()->description('JSContact organizations map'),
            'titles' => $schema->object()->description('JSContact titles map'),
            'anniversaries' => $schema->object()->description('JSContact anniversaries map (birthday)'),
            'notes' => $schema->object()->description('JSContact notes map'),
            'links' => $schema->object()->description('JSContact links map (website)'),
            'keywords' => $schema->object()->description('JSContact keywords map'),
        ];
    }

    protected function requiredScope(): ?string
    {
        return McpScopes::CONTACTS_WRITE;
    }

    protected function accessMode(): string
    {
        return 'write';
    }

    protected function target(Request $request): array|string|null
    {
        return [
            'action' => (string) $request->get('action', ''),
            'contactId' => (string) $request->get('contactId', ''),
        ];
    }

    protected function run(Request $request): Response
    {
        $action = $this->writeAction($request);
        $username = (string) $this->user()->username;

        if ($action === 'delete') {
            $contactId = $this->requiredContactId($request);

            return $this->json($this->cards->deleteWithPrecondition($username, $contactId, null, null, false));
        }

        $payload = $this->cardPayload($request);
        if ($action === 'create') {
            if (! isset($payload['addressBookIds']) || ! is_array($payload['addressBookIds']) || $payload['addressBookIds'] === []) {
                throw new \InvalidArgumentException('addressBookIds is required.');
            }

            return $this->json($this->subset($this->cards->create($username, $payload)));
        }

        return $this->json($this->subset(
            $this->cards->patchWithPrecondition($username, $this->requiredContactId($request), $payload, null, null, false),
        ));
    }

    /**
     * @return array<string, mixed>
     */
    private function cardPayload(Request $request): array
    {
        $payload = [];
        if ($request->has('kind')) {
            $payload['kind'] = $request->get('kind');
        }
        foreach (self::MAP_FIELDS as $key) {
            if (! $request->has($key)) {
                continue;
            }
            $value = $request->get($key);
            if ($value !== null && ! is_array($value)) {
                throw new \InvalidArgumentException($key.' must be an object.');
            }
            $payload[$key] = $value;
        }
        $this->capNoteTexts($payload);

        return $payload;
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function capNoteTexts(array $payload): void
    {
        $notes = $payload['notes'] ?? null;
        if (! is_array($notes)) {
            return;
        }
        foreach ($notes as $entry) {
            if (is_array($entry) && isset($entry['note']) && is_string($entry['note'])) {
                $this->assertTextWithinCap($entry['note'], 'notes');
            }
        }
    }

    /**
     * @param  array<string, mixed>  $card
     * @return array<string, mixed>
     */
    private function subset(array $card): array
    {
        return $this->pick($card, self::SUBSET);
    }

    private function requiredContactId(Request $request): string
    {
        $id = trim((string) $request->get('contactId', ''));
        if ($id === '') {
            throw new \InvalidArgumentException('contactId is required.');
        }

        return $id;
    }
}
