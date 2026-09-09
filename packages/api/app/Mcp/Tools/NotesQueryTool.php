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
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

#[IsReadOnly]
final class NotesQueryTool extends WgwMcpTool
{
    protected string $name = 'notes_query';

    protected string $description = 'List or get notes the signed-in user can access.';

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
            'noteId' => $schema->string()->description('Note id. When set, returns that note.'),
            'notebookId' => $schema->string()->description('Notebook id to list notes in'),
        ];
    }

    protected function requiredScope(): ?string
    {
        return McpScopes::NOTES_READ;
    }

    protected function accessMode(): string
    {
        return 'read';
    }

    protected function target(Request $request): array|string|null
    {
        return [
            'noteId' => (string) $request->get('noteId', ''),
            'notebookId' => (string) $request->get('notebookId', ''),
        ];
    }

    protected function run(Request $request): Response
    {
        $username = (string) $this->user()->username;
        $noteId = trim((string) $request->get('noteId', ''));
        if ($noteId !== '') {
            return $this->json($this->subset($this->notes->show($username, $noteId)));
        }

        $notebookId = trim((string) $request->get('notebookId', ''));
        if ($notebookId === '') {
            throw new \InvalidArgumentException('notebookId or noteId is required.');
        }

        $listed = $this->notes->list($username, $notebookId, null, null);
        $list = [];
        foreach ($listed['list'] as $note) {
            $list[] = $this->subset($note);
        }

        return $this->json(['list' => $list]);
    }

    /**
     * @param  array<string, mixed>  $note
     * @return array<string, mixed>
     */
    private function subset(array $note): array
    {
        $row = $this->pick($note, ['id', 'notebookId', 'title', 'body', 'categories']);
        if (isset($row['body']) && is_string($row['body']) && strlen($row['body']) > self::TEXT_MAX_BYTES) {
            $row['body'] = substr($row['body'], 0, self::TEXT_MAX_BYTES);
            $row['truncated'] = true;
        }

        return $row;
    }
}
