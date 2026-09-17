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
use Laravel\Mcp\Server\Tools\Annotations\IsDestructive;

#[IsDestructive]
final class AddressBookWriteTool extends WgwMcpTool
{
    protected string $name = 'addressbook_write';

    protected string $description = 'Update an address book description or dismiss a shared book. Owner create, rename, and delete are not allowed.';

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
            'action' => $schema->string()->enum(['create', 'update', 'delete'])->required()
                ->description('create is always forbidden; update description; delete dismisses a sharee copy'),
            'addressBookId' => $schema->string()->description('Address book id (required for update and delete)'),
            'description' => $schema->string()->nullable()->description('Owner description (update)'),
            'isSubscribed' => $schema->boolean()->description('Sharees may set false to dismiss the shared book'),
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
        $action = $this->writeAction($request);
        $username = (string) $this->user()->username;
        $this->assertTextWithinCap($request->get('description') !== null ? (string) $request->get('description') : null, 'description');

        if ($action === 'create') {
            return $this->json($this->subset($this->books->create($username, [])));
        }

        $addressBookId = trim((string) $request->get('addressBookId', ''));
        if ($addressBookId === '') {
            throw new \InvalidArgumentException('addressBookId is required.');
        }

        if ($action === 'delete') {
            return $this->json($this->books->delete($username, $addressBookId));
        }

        return $this->json($this->subset($this->books->update($username, $addressBookId, $this->payload($request))));
    }

    /**
     * @return array<string, mixed>
     */
    private function payload(Request $request): array
    {
        $payload = [];
        if ($request->has('description')) {
            $payload['description'] = $request->get('description');
        }
        if ($request->has('isSubscribed')) {
            $payload['isSubscribed'] = (bool) $request->get('isSubscribed');
        }

        return $payload;
    }

    /**
     * @param  array<string, mixed>  $book
     * @return array<string, mixed>
     */
    private function subset(array $book): array
    {
        return $this->pick($book, ['id', 'name', 'description', 'isDefault', 'isSharee', 'shareWith', 'myRights']);
    }
}
