<?php

declare(strict_types=1);

namespace App\Dav\Server;

use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use App\Services\Calendars\CalendarMeetLinkWriteHook;
use App\Services\Calendars\CalendarMeetOwnerPrincipal;
use Sabre\DAV\Auth\Plugin as AuthPlugin;
use Sabre\DAV\Server;
use Sabre\DAV\ServerPlugin;
use Sabre\HTTP\RequestInterface;
use Sabre\HTTP\ResponseInterface;

/**
 * CalDAV PUT after-write: same Meet reserve / expiresAt hook as JMAP persist.
 */
final class CalendarMeetLinkPlugin extends ServerPlugin
{
    private Server $server;

    /** @var array<string, string|null> */
    private array $oldIcsByPath = [];

    public function __construct(private readonly CalendarMeetLinkWriteHook $hook) {}

    public function initialize(Server $server): void
    {
        $this->server = $server;
        $server->on('beforeMethod:PUT', [$this, 'beforePut']);
        $server->on('afterMethod:PUT', [$this, 'afterPut']);
    }

    public function beforePut(RequestInterface $request, ResponseInterface $response): void
    {
        $path = trim((string) $request->getPath(), '/');
        if (! $this->isCalendarObjectPath($path)) {
            return;
        }

        try {
            $node = $this->server->tree->getNodeForPath($path);
            $this->oldIcsByPath[$path] = is_object($node) && method_exists($node, 'get')
                ? (string) $node->get()
                : null;
        } catch (\Throwable) {
            $this->oldIcsByPath[$path] = null;
        }
    }

    public function afterPut(RequestInterface $request, ResponseInterface $response): void
    {
        $status = $response->getStatus();
        if ($status < 200 || $status >= 400) {
            return;
        }

        $path = trim((string) $request->getPath(), '/');
        $parsed = $this->parseCalendarObjectPath($path);
        if ($parsed === null) {
            return;
        }

        $instance = CalendarInstance::query()
            ->where('principaluri', $parsed['principalUri'])
            ->where('uri', $parsed['calendarUri'])
            ->first();
        if (! $instance instanceof CalendarInstance) {
            return;
        }

        $object = CalendarObject::query()
            ->where('uri', $parsed['objectUri'])
            ->whereHas('calendar.instances', function ($query) use ($parsed): void {
                $query->where('principaluri', $parsed['principalUri'])
                    ->where('uri', $parsed['calendarUri']);
            })
            ->first();
        if (! $object instanceof CalendarObject) {
            return;
        }
        $newIcs = is_string($object->calendardata) ? $object->calendardata : (string) $object->calendardata;
        if (trim($newIcs) === '') {
            return;
        }

        $oldIcs = $this->oldIcsByPath[$path] ?? null;
        unset($this->oldIcsByPath[$path]);

        $this->hook->afterPersist(
            $newIcs,
            $oldIcs,
            CalendarMeetOwnerPrincipal::fromInstance($instance),
            $this->createdByMarker(),
        );
    }

    private function createdByMarker(): string
    {
        $auth = $this->server->getPlugin('auth');
        $principal = $auth instanceof AuthPlugin ? (string) $auth->getCurrentPrincipal() : '';
        if ($principal === '') {
            return CalendarMeetOwnerPrincipal::actorMarker('unknown');
        }

        return CalendarMeetOwnerPrincipal::fromPrincipalUri($principal);
    }

    private function isCalendarObjectPath(string $path): bool
    {
        return $this->parseCalendarObjectPath($path) !== null;
    }

    /**
     * @return array{principalUri: string, calendarUri: string, objectUri: string}|null
     */
    private function parseCalendarObjectPath(string $path): ?array
    {
        $path = trim($path, '/');
        if (! str_starts_with($path, 'calendars/')) {
            return null;
        }
        $rest = substr($path, strlen('calendars/'));
        if ($rest === '' || str_contains($rest, '/inbox/')) {
            return null;
        }

        $segments = explode('/', $rest);
        if (count($segments) < 3) {
            return null;
        }

        $objectUri = array_pop($segments);
        $calendarUri = array_pop($segments);
        if ($objectUri === null || $calendarUri === null || $calendarUri === 'inbox') {
            return null;
        }
        if ($calendarUri === '' || $objectUri === '') {
            return null;
        }

        $principalName = implode('/', $segments);
        if ($principalName === '' || $principalName === 'inbox') {
            return null;
        }

        return [
            'principalUri' => 'principals/'.$principalName,
            'calendarUri' => $calendarUri,
            'objectUri' => $objectUri,
        ];
    }
}
