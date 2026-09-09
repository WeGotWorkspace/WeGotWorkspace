<?php

declare(strict_types=1);

namespace App\Mcp\Tools;

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
final class MeetCreateScheduledTool extends WgwMcpTool
{
    protected string $name = 'meet_create_scheduled';

    protected string $description = 'Create a meeting-kind Meet collection. With calendar.write also creates the calendar event. Without calendar.write, returns the meeting href only.';

    /** @var list<string> */
    private const CHANNEL_SUBSET = [
        'id',
        'name',
        'kind',
        'topic',
        'color',
        'scope',
        'groupSlug',
        'shareWith',
        'myRights',
        'guestRoomCode',
    ];

    /** @var list<string> */
    private const EVENT_SUBSET = [
        'id',
        'calendarIds',
        'title',
        'start',
        'end',
        'description',
        'participants',
        'links',
    ];

    public function __construct(
        McpAuditLogger $audit,
        AdminRoleResolver $adminRoles,
        private ChatChannelRepository $channels,
        private CalendarEventRepository $events,
        private CalendarMeetLinkHref $meetHrefs,
    ) {
        parent::__construct($audit, $adminRoles);
    }

    public function schema(JsonSchema $schema): array
    {
        return [
            'name' => $schema->string()->required()->description('Meeting title (channel name and default event title)'),
            'calendarId' => $schema->string()->description('Calendar id (required when the token has calendar.write)'),
            'start' => $schema->string()->description('Event start ISO-8601 (required when the token has calendar.write)'),
            'end' => $schema->string()->nullable()->description('Event end ISO-8601'),
            'description' => $schema->string()->nullable()->description('Event notes'),
            'timeZone' => $schema->string()->nullable(),
            'showWithoutTime' => $schema->boolean(),
            'participants' => $schema->object()->description('JSCalendar participants map'),
        ];
    }

    protected function requiredScope(): ?string
    {
        return McpScopes::MEET_WRITE;
    }

    protected function accessMode(): string
    {
        return 'write';
    }

    protected function target(Request $request): array|string|null
    {
        return [
            'name' => (string) $request->get('name', ''),
            'calendarId' => (string) $request->get('calendarId', ''),
        ];
    }

    protected function run(Request $request): Response
    {
        $name = trim((string) $request->get('name', ''));
        if ($name === '') {
            throw new \InvalidArgumentException('name is required.');
        }
        $this->assertTextWithinCap($request->get('description') !== null ? (string) $request->get('description') : null, 'description');

        $canWriteCalendar = $this->tokenAllows(McpScopes::CALENDAR_WRITE);
        if ($canWriteCalendar) {
            $this->assertEventFields($request);
        }

        $username = (string) $this->user()->username;
        $channel = $this->channels->create($username, [
            'name' => $name,
            'kind' => ChatChannelMeta::KIND_MEETING,
        ]);
        $href = $this->meetingHref($channel);

        $event = null;
        if ($canWriteCalendar) {
            $event = $this->subsetEvent($this->events->create($username, $this->eventPayload($request, $name, $href)));
        }

        return $this->json([
            'channel' => $this->pick($channel, self::CHANNEL_SUBSET),
            'href' => $href,
            'event' => $event,
        ]);
    }

    private function assertEventFields(Request $request): void
    {
        if (trim((string) $request->get('calendarId', '')) === '') {
            throw new \InvalidArgumentException('calendarId is required when calendar.write is granted.');
        }
        if (trim((string) $request->get('start', '')) === '') {
            throw new \InvalidArgumentException('start is required when calendar.write is granted.');
        }
    }

    /**
     * @param  array<string, mixed>  $channel
     */
    private function meetingHref(array $channel): string
    {
        $id = (string) ($channel['id'] ?? '');
        $public = str_starts_with(strtolower($id), 'chat-') ? substr($id, 5) : $id;

        return $this->meetHrefs->absoluteHref('/meet/meetings/'.strtolower($public));
    }

    /**
     * @return array<string, mixed>
     */
    private function eventPayload(Request $request, string $name, string $href): array
    {
        $payload = [
            'calendarIds' => [trim((string) $request->get('calendarId')) => true],
            'title' => $name,
            'start' => (string) $request->get('start'),
            'links' => [
                'meet' => ['@type' => 'Link', 'href' => $href, 'rel' => 'describedby'],
            ],
        ];
        foreach (['end', 'description', 'timeZone'] as $key) {
            if ($request->has($key)) {
                $payload[$key] = $request->get($key);
            }
        }
        if ($request->has('showWithoutTime')) {
            $payload['showWithoutTime'] = (bool) $request->get('showWithoutTime');
        }
        if ($request->has('participants')) {
            $participants = $request->get('participants');
            if ($participants !== null && ! is_array($participants)) {
                throw new \InvalidArgumentException('participants must be an object.');
            }
            $payload['participants'] = $participants;
        }

        return $payload;
    }

    /**
     * @param  array<string, mixed>  $event
     * @return array<string, mixed>
     */
    private function subsetEvent(array $event): array
    {
        return $this->pick($event, self::EVENT_SUBSET);
    }
}
