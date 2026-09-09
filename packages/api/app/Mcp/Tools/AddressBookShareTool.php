<?php

declare(strict_types=1);

namespace App\Mcp\Tools;

use App\Services\Auth\AdminRoleResolver;
use App\Services\Contacts\AddressBookRepository;
use App\Services\Mcp\McpAuditLogger;
use App\Services\Mcp\McpScopes;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;

final class AddressBookShareTool extends WgwMcpTool
{
    protected string $name = 'addressbook_share';

    protected string $description = 'Get or set address book shareWith. Null grant revokes a principal.';

    public function __construct(
        McpAuditLogger $audit,
        AdminRoleResolver $adminRoles,
        private AddressBookRepository $books,
    ) {
        parent::__construct($audit, $adminRoles);
    }

    public function schema(JsonSchema $schema): array
    {
        return [
            'action' => $schema->string()->enum(['get', 'set'])->required()->description('get or set'),
            'addressBookId' => $schema->string()->required()->description('Address book id'),
            'shareWith' => $schema->object()->nullable()
                ->description('Principal map {user: {mayRead, mayWrite}, …}. Null grant revokes. Null map revokes all.'),
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
            'addressBookId' => (string) $request->get('addressBookId', ''),
        ];
    }

    protected function run(Request $request): Response
    {
        $action = $this->shareAction($request);
        $addressBookId = trim((string) $request->get('addressBookId', ''));
        if ($addressBookId === '') {
            throw new \InvalidArgumentException('addressBookId is required.');
        }

        $username = (string) $this->user()->username;
        if ($action === 'get') {
            $book = $this->books->show($username, $addressBookId);

            return $this->json($this->pick($book, ['id', 'name', 'shareWith', 'myRights']));
        }

        if (! $request->has('shareWith')) {
            throw new \InvalidArgumentException('shareWith is required for set (object or null).');
        }

        $updated = $this->books->update($username, $addressBookId, [
            'shareWith' => $request->get('shareWith'),
        ]);

        return $this->json($this->pick($updated, ['id', 'name', 'shareWith', 'myRights']));
    }
}
