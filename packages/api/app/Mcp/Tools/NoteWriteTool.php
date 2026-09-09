<?php

declare(strict_types=1);

namespace App\Mcp\Tools;

use App\Services\Auth\AdminRoleResolver;
use App\Services\Mcp\McpAuditLogger;
use App\Services\Mcp\McpScopes;
use App\Services\Notes\NoteRepository;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Tools\Annotations\IsDestructive;

#[IsDestructive]
final class NoteWriteTool extends WgwMcpTool
{
    protected string $name = 'note_write';

    protected string $description = 'Create, update, or delete a note (notebook, title, body, tags).';

    public function __construct(
        McpAuditLogger $audit,
        AdminRoleResolver $adminRoles,
        private NoteRepository $notes,
    ) {
        parent::__construct($audit, $adminRoles);
    }

    public function schema(JsonSchema $schema): array
    {
        return [
            'action' => $schema->string()->enum(['create', 'update', 'delete'])->required()
                ->description('create, update, or delete'),
            'noteId' => $schema->string()->description('Note id (required for update and delete)'),
            'notebookId' => $schema->string()->description('Notebook id (required for create; patch to move)'),
            'title' => $schema->string()->nullable()->description('Note title'),
            'body' => $schema->string()->nullable()->description('Note body (markdown)'),
            'categories' => $schema->array()->description('Tags'),
        ];
    }

    protected function requiredScope(): ?string
    {
        return McpScopes::NOTES_WRITE;
    }

    protected function accessMode(): string
    {
        return 'write';
    }

    protected function target(Request $request): array|string|null
    {
        return [
            'action' => (string) $request->get('action', ''),
            'noteId' => (string) $request->get('noteId', ''),
            'notebookId' => (string) $request->get('notebookId', ''),
        ];
    }

    protected function run(Request $request): Response
    {
        $action = $this->writeAction($request);
        $username = (string) $this->user()->username;

        if ($action === 'delete') {
            $noteId = $this->requiredId($request, 'noteId');

            return $this->json($this->notes->delete($username, $noteId, null, null, false));
        }

        $payload = $this->notePayload($request);
        if ($action === 'create') {
            $notebookId = trim((string) $request->get('notebookId', ''));
            if ($notebookId === '') {
                throw new \InvalidArgumentException('notebookId is required.');
            }
            $payload['notebookId'] = $notebookId;

            return $this->json($this->subset($this->notes->create($username, $payload)));
        }

        $noteId = $this->requiredId($request, 'noteId');

        return $this->json($this->subset(
            $this->notes->patch($username, $noteId, $payload, null, null, false),
        ));
    }

    /**
     * @return array<string, mixed>
     */
    private function notePayload(Request $request): array
    {
        $payload = [];
        foreach (['title', 'body', 'notebookId'] as $key) {
            if ($request->has($key)) {
                $payload[$key] = $request->get($key);
            }
        }
        if (isset($payload['body']) && is_string($payload['body'])) {
            $this->assertTextWithinCap($payload['body'], 'body');
        }
        if ($request->has('categories')) {
            $categories = $request->get('categories');
            if ($categories !== null && ! is_array($categories)) {
                throw new \InvalidArgumentException('categories must be an array.');
            }
            $payload['categories'] = $categories;
        }

        return $payload;
    }

    /**
     * @param  array<string, mixed>  $note
     * @return array<string, mixed>
     */
    private function subset(array $note): array
    {
        return $this->pick($note, ['id', 'notebookId', 'title', 'body', 'categories']);
    }

    private function requiredId(Request $request, string $key): string
    {
        $id = trim((string) $request->get($key, ''));
        if ($id === '') {
            throw new \InvalidArgumentException($key.' is required.');
        }

        return $id;
    }
}
