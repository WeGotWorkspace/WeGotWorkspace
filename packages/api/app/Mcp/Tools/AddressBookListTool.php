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
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

#[IsReadOnly]
final class AddressBookListTool extends WgwMcpTool
{
    protected string $name = 'addressbook_list';

    protected string $description = 'List or get address books the signed-in user can access.';

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
            'addressBookId' => $schema->string()->description('Address book id. When set, returns that book.'),
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
        return ['addressBookId' => (string) $request->get('addressBookId', '')];
    }

    protected function run(Request $request): Response
    {
        $username = (string) $this->user()->username;
        $addressBookId = trim((string) $request->get('addressBookId', ''));
        if ($addressBookId !== '') {
            return $this->json($this->subset($this->books->show($username, $addressBookId)));
        }

        $list = [];
        foreach ($this->books->list($username)['list'] as $book) {
            $list[] = $this->subset($book);
        }

        return $this->json(['list' => $list]);
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
