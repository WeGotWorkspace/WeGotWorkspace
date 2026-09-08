<?php

declare(strict_types=1);

namespace App\Mcp\Tools;

use App\Services\Auth\AdminRoleResolver;
use App\Services\Calendars\CalendarCollectionAccess;
use App\Services\Mcp\McpAuditLogger;
use App\Services\Mcp\McpScopes;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

#[IsReadOnly]
final class CalendarListTool extends WgwMcpTool
{
    protected string $name = 'calendar_list';

    protected string $description = 'List calendars the signed-in user can access.';

    public function __construct(
        McpAuditLogger $audit,
        AdminRoleResolver $adminRoles,
        private CalendarCollectionAccess $calendars,
    ) {
        parent::__construct($audit, $adminRoles);
    }

    public function schema(JsonSchema $schema): array
    {
        return [];
    }

    protected function requiredScope(): ?string
    {
        return McpScopes::CALENDAR;
    }

    protected function accessMode(): string
    {
        return 'read';
    }

    protected function target(Request $request): array|string|null
    {
        return 'calendars';
    }

    protected function run(Request $request): Response
    {
        $instances = $this->calendars->accessibleInstances(
            (string) $this->user()->username,
            static fn ($query) => $query->supportsVevent(),
        );

        $list = [];
        foreach ($instances as $instance) {
            $list[] = [
                'id' => (string) $instance->uri,
                'calendarId' => (int) $instance->calendarid,
                'displayName' => (string) ($instance->displayname ?: $instance->uri),
            ];
        }

        return $this->json(['list' => $list]);
    }
}
