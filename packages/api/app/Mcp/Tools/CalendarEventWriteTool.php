<?php

declare(strict_types=1);

namespace App\Mcp\Tools;

use App\Exceptions\ApiHttpException;
use App\Models\ChatChannelMeta;
use App\Services\Auth\AdminRoleResolver;
use App\Services\Calendars\CalendarEventRepository;
use App\Services\Calendars\CalendarMeetLinkHref;
use App\Services\Chat\ChatChannelRepository;
use App\Services\Mcp\McpAuditLogger;
use App\Services\Mcp\McpScopes;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Tools\Annotations\IsDestructive;

#[IsDestructive]
final class CalendarEventWriteTool extends WgwMcpTool
{
    protected string $name = 'calendar_event_write';

    protected string $description = 'Create, update, or delete a calendar event (notes, RRULE, participants, Meet link).';

    public function __construct(
        McpAuditLogger $audit,
        AdminRoleResolver $adminRoles,
        private CalendarEventRepository $events,
        private ChatChannelRepository $channels,
        private CalendarMeetLinkHref $meetHrefs,
    ) {
        parent::__construct($audit, $adminRoles);
    }

    public function schema(JsonSchema $schema): array
    {
        return [
            'action' => $schema->string()->enum(['create', 'update', 'delete'])->required()
                ->description('create, update, or delete'),
            'eventId' => $schema->string()->description('Event id (required for update and delete)'),
            'calendarId' => $schema->string()->description('Calendar id (required for create)'),
            'title' => $schema->string()->description('Event title'),
            'start' => $schema->string()->description('Start (ISO-8601)'),
            'end' => $schema->string()->nullable()->description('End (ISO-8601)'),
            'description' => $schema->string()->nullable()->description('Event notes'),
            'timeZone' => $schema->string()->nullable(),
            'showWithoutTime' => $schema->boolean(),
            'recurrenceRules' => $schema->array()->description('JSCalendar recurrenceRules (master RRULE)'),
            'participants' => $schema->object()->description('JSCalendar participants map'),
            'meetChannelId' => $schema->string()->description('Existing #channel id to attach as Meet link'),
            'meet' => $schema->string()->enum(['new'])->description('Allocate a new /meet/meetings/{code} link'),
            'links' => $schema->object()->description('JSCalendar links; links.meet.href is accepted as-is'),
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
            'eventId' => (string) $request->get('eventId', ''),
            'calendarId' => (string) $request->get('calendarId', ''),
        ];
    }

    protected function run(Request $request): Response
    {
        $action = $this->writeAction($request);
        $username = (string) $this->user()->username;

        if ($action === 'delete') {
            $eventId = trim((string) $request->get('eventId', ''));
            if ($eventId === '') {
                throw new \InvalidArgumentException('eventId is required.');
            }

            return $this->json($this->events->deleteWithPrecondition($username, $eventId, null, null, false));
        }

        $payload = $this->eventPayload($request, $username);
        if ($action === 'create') {
            $created = $this->events->create($username, $payload);

            return $this->json($this->subset($created));
        }

        $eventId = trim((string) $request->get('eventId', ''));
        if ($eventId === '') {
            throw new \InvalidArgumentException('eventId is required.');
        }

        return $this->json($this->subset(
            $this->events->patchWithPrecondition($username, $eventId, $payload, null, null, false),
        ));
    }

    /**
     * @return array<string, mixed>
     */
    private function eventPayload(Request $request, string $username): array
    {
        $payload = [];
        $calendarId = trim((string) $request->get('calendarId', ''));
        if ($calendarId !== '') {
            $payload['calendarIds'] = [$calendarId => true];
        }

        foreach (['title', 'start', 'end', 'description', 'timeZone'] as $key) {
            if ($request->has($key)) {
                $payload[$key] = $request->get($key);
            }
        }
        if (isset($payload['description']) && is_string($payload['description'])) {
            $this->assertTextWithinCap($payload['description'], 'description');
        }
        if ($request->has('showWithoutTime')) {
            $payload['showWithoutTime'] = (bool) $request->get('showWithoutTime');
        }
        foreach (['recurrenceRules', 'participants', 'links'] as $key) {
            if ($request->has($key)) {
                $value = $request->get($key);
                if ($value !== null && ! is_array($value)) {
                    throw new \InvalidArgumentException($key.' must be an object or array.');
                }
                $payload[$key] = $value;
            }
        }

        return $this->attachMeet($username, $payload, $request);
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    private function attachMeet(string $username, array $payload, Request $request): array
    {
        $links = is_array($payload['links'] ?? null) ? $payload['links'] : [];
        $channelId = trim((string) $request->get('meetChannelId', ''));
        $meet = $request->get('meet');
        $rawMeetHref = $this->meetHrefFromLinks($links);

        if ($channelId !== '') {
            $channel = $this->channels->show($username, $channelId);
            if (($channel['kind'] ?? '') !== ChatChannelMeta::KIND_CHANNEL) {
                throw new ApiHttpException(400, 'meetChannelId must be a #channel (kind channel).', 'bad_request');
            }
            $href = $this->meetHrefs->absoluteHref($this->meetHrefs->channelPath((string) $channel['id']));
            $links['meet'] = ['@type' => 'Link', 'href' => $href, 'rel' => 'describedby'];
        } elseif ($meet === 'new') {
            $code = $this->meetHrefs->allocateAdHocRoomCode();
            $href = $this->meetHrefs->absoluteHref($this->meetHrefs->meetingsPath($code));
            $links['meet'] = ['@type' => 'Link', 'href' => $href, 'rel' => 'describedby'];
        } elseif ($rawMeetHref !== '') {
            $links['meet'] = is_array($links['meet'] ?? null)
                ? $links['meet']
                : ['@type' => 'Link', 'href' => $rawMeetHref, 'rel' => 'describedby'];
        }

        if ($links !== []) {
            $payload['links'] = $links;
        }

        return $payload;
    }

    /**
     * @param  array<string, mixed>  $links
     */
    private function meetHrefFromLinks(array $links): string
    {
        $meet = $links['meet'] ?? null;
        if (! is_array($meet)) {
            return '';
        }
        $href = $meet['href'] ?? null;

        return is_string($href) ? trim($href) : '';
    }

    /**
     * @param  array<string, mixed>  $event
     * @return array<string, mixed>
     */
    private function subset(array $event): array
    {
        return $this->pick($event, [
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
    }
}
