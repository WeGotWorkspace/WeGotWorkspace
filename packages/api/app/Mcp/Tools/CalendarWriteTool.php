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
use Laravel\Mcp\Server\Tools\Annotations\IsDestructive;

#[IsDestructive]
final class CalendarWriteTool extends WgwMcpTool
{
    protected string $name = 'calendar_write';

    protected string $description = 'Create, update, or delete a calendar.';

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
            'action' => $schema->string()->enum(['create', 'update', 'delete'])->required()
                ->description('create, update, or delete'),
            'calendarId' => $schema->string()->description('Calendar id (required for update and delete)'),
            'name' => $schema->string()->description('Display name'),
            'description' => $schema->string()->nullable()->description('Calendar description'),
            'color' => $schema->string()->nullable()->description('Calendar color'),
            'timeZone' => $schema->string()->nullable()->description('Calendar time zone'),
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
        $action = $this->writeAction($request);
        $username = (string) $this->user()->username;
        $this->assertTextWithinCap($request->get('description') !== null ? (string) $request->get('description') : null, 'description');

        if ($action === 'create') {
            $payload = $this->collectionPayload($request, requireName: true);

            return $this->json($this->subset($this->calendars->create($username, $payload)));
        }

        $calendarId = trim((string) $request->get('calendarId', ''));
        if ($calendarId === '') {
            throw new \InvalidArgumentException('calendarId is required.');
        }

        if ($action === 'delete') {
            return $this->json($this->calendars->delete($username, $calendarId, [
                'onDestroyRemoveContents' => (bool) $request->get('onDestroyRemoveContents', false),
            ]));
        }

        return $this->json($this->subset($this->calendars->update($username, $calendarId, $this->collectionPayload($request, requireName: false))));
    }

    /**
     * @return array<string, mixed>
     */
    private function collectionPayload(Request $request, bool $requireName): array
    {
        $payload = [];
        if ($request->has('name') || $requireName) {
            $payload['name'] = (string) $request->get('name', '');
        }
        foreach (['description', 'color', 'timeZone'] as $key) {
            if ($request->has($key)) {
                $payload[$key] = $request->get($key);
            }
        }

        return $payload;
    }

    /**
     * @param  array<string, mixed>  $calendar
     * @return array<string, mixed>
     */
    private function subset(array $calendar): array
    {
        return $this->pick($calendar, ['id', 'name', 'description', 'color', 'timeZone', 'shareWith', 'myRights', 'scope', 'groupSlug']);
    }
}
