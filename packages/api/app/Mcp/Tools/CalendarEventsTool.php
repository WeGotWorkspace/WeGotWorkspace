<?php

declare(strict_types=1);

namespace App\Mcp\Tools;

use App\Services\Auth\AdminRoleResolver;
use App\Services\Calendars\CalendarEventRepository;
use App\Services\Mcp\McpAuditLogger;
use App\Services\Mcp\McpScopes;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

#[IsReadOnly]
final class CalendarEventsTool extends WgwMcpTool
{
    protected string $name = 'calendar_events';

    protected string $description = 'List or get calendar events the signed-in user can access.';

    public function __construct(
        McpAuditLogger $audit,
        AdminRoleResolver $adminRoles,
        private CalendarEventRepository $events,
    ) {
        parent::__construct($audit, $adminRoles);
    }

    public function schema(JsonSchema $schema): array
    {
        return [
            'eventId' => $schema->string()->description('Event id. When set, returns that event.'),
            'calendarId' => $schema->string()->description('Calendar id (required when listing)'),
            'after' => $schema->string()->description('Inclusive window start (ISO-8601)'),
            'before' => $schema->string()->description('Exclusive window end (ISO-8601)'),
            'title' => $schema->string()->description('Optional title substring filter'),
        ];
    }

    protected function requiredScope(): ?string
    {
        return McpScopes::CALENDAR_READ;
    }

    protected function accessMode(): string
    {
        return 'read';
    }

    protected function target(Request $request): array|string|null
    {
        return [
            'eventId' => (string) $request->get('eventId', ''),
            'calendarId' => (string) $request->get('calendarId', ''),
        ];
    }

    protected function run(Request $request): Response
    {
        $username = (string) $this->user()->username;
        $eventId = trim((string) $request->get('eventId', ''));
        if ($eventId !== '') {
            return $this->json($this->subset($this->events->show($username, $eventId)));
        }

        $calendarId = trim((string) $request->get('calendarId', ''));
        if ($calendarId === '') {
            throw new \InvalidArgumentException('calendarId or eventId is required.');
        }

        $after = $this->optionalString($request, 'after');
        $before = $this->optionalString($request, 'before');
        $title = $this->optionalString($request, 'title');
        if ($title !== null || $after !== null || $before !== null) {
            $filter = ['inCalendars' => [$calendarId]];
            if ($title !== null) {
                $filter['title'] = $title;
            }
            if ($after !== null) {
                $filter['after'] = $after;
            }
            if ($before !== null) {
                $filter['before'] = $before;
            }
            $query = $this->events->query($username, $filter);
            $list = [];
            foreach ($query['ids'] as $id) {
                $list[] = $this->subset($this->events->show($username, $id));
            }

            return $this->json(['list' => $list]);
        }

        $listed = $this->events->list($username, $calendarId);
        $list = [];
        foreach ($listed['list'] as $event) {
            $list[] = $this->subset($event);
        }

        return $this->json(['list' => $list]);
    }

    /**
     * @param  array<string, mixed>  $event
     * @return array<string, mixed>
     */
    private function subset(array $event): array
    {
        $row = $this->pick($event, [
            'id',
            'calendarIds',
            'uid',
            'title',
            'start',
            'end',
            'duration',
            'timeZone',
            'showWithoutTime',
            'description',
            'recurrenceRules',
            'participants',
            'links',
        ]);
        if (isset($row['description']) && is_string($row['description']) && strlen($row['description']) > self::TEXT_MAX_BYTES) {
            $row['description'] = substr($row['description'], 0, self::TEXT_MAX_BYTES);
            $row['truncated'] = true;
        }

        return $row;
    }

    private function optionalString(Request $request, string $key): ?string
    {
        $value = $request->get($key);
        if (! is_string($value) || trim($value) === '') {
            return null;
        }

        return trim($value);
    }
}
