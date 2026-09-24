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
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

#[IsReadOnly]
final class ContactQueryTool extends WgwMcpTool
{
    protected string $name = 'contact_query';

    protected string $description = 'List or get contacts the signed-in user can access.';

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
            'contactId' => $schema->string()->description('Contact id. When set, returns that contact.'),
            'addressBookId' => $schema->string()->description('Address book id to list contacts in'),
        ];
    }

    protected function requiredScope(): ?string
    {
        return McpScopes::CONTACTS_READ;
    }

    protected function accessMode(): string
    {
        return 'read';
    }

    protected function target(Request $request): array|string|null
    {
        return [
            'contactId' => (string) $request->get('contactId', ''),
            'addressBookId' => (string) $request->get('addressBookId', ''),
        ];
    }

    protected function run(Request $request): Response
    {
        $username = (string) $this->user()->username;
        $contactId = trim((string) $request->get('contactId', ''));
        if ($contactId !== '') {
            return $this->json($this->subset($this->cards->show($username, $contactId)));
        }

        $addressBookId = trim((string) $request->get('addressBookId', ''));
        if ($addressBookId === '') {
            throw new \InvalidArgumentException('addressBookId or contactId is required.');
        }

        $list = [];
        foreach ($this->cards->list($username, $addressBookId)['list'] as $card) {
            $list[] = $this->subset($card);
        }

        return $this->json(['list' => $list]);
    }

    /**
     * @param  array<string, mixed>  $card
     * @return array<string, mixed>
     */
    private function subset(array $card): array
    {
        return $this->pick($card, self::SUBSET);
    }
}
