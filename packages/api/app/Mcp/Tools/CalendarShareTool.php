<?php

declare(strict_types=1);

namespace App\Mcp\Tools;

use App\Services\Auth\AdminRoleResolver;
use App\Services\Calendars\CalendarRepository;
use App\Services\Mcp\McpAuditLogger;
use App\Services\Mcp\McpScopes;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;

final class CalendarShareTool extends WgwMcpTool
{
    protected string $name = 'calendar_share';

    protected string $description = 'Get or set calendar collection shareWith. Null grant revokes a principal.';

    public function __construct(
        McpAuditLogger $audit,
        AdminRoleResolver $adminRoles,
        private CalendarRepository $calendars,
    ) {
        parent::__construct($audit, $adminRoles);
    }

    public function schema(JsonSchema $schema): array
    {
        return [
            'action' => $schema->string()->enum(['get', 'set'])->required()->description('get or set'),
            'calendarId' => $schema->string()->required()->description('Calendar id'),
            'shareWith' => $schema->object()->nullable()
                ->description('Principal map. Omit/null grant revokes. Null map revokes all.'),
        ];
    }

    protected function requiredScope(): ?string
    {
        return McpScopes::CALENDAR_WRITE;
    }

    protected function accessMode(): string
    {
        return 'write';
    }

    protected function target(Request $request): array|string|null
    {
        return [
            'action' => (string) $request->get('action', ''),
            'calendarId' => (string) $request->get('calendarId', ''),
        ];
    }

    protected function run(Request $request): Response
    {
        $action = $this->shareAction($request);
        $calendarId = trim((string) $request->get('calendarId', ''));
        if ($calendarId === '') {
            throw new \InvalidArgumentException('calendarId is required.');
        }

        $username = (string) $this->user()->username;
        if ($action === 'get') {
            $calendar = $this->calendars->show($username, $calendarId);

            return $this->json($this->pick($calendar, ['id', 'name', 'shareWith', 'myRights']));
        }

        if (! $request->has('shareWith')) {
            throw new \InvalidArgumentException('shareWith is required for set (object or null).');
        }

        $updated = $this->calendars->update($username, $calendarId, [
            'shareWith' => $request->get('shareWith'),
        ]);

        return $this->json($this->pick($updated, ['id', 'name', 'shareWith', 'myRights']));
    }
}
