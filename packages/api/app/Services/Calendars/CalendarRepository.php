<?php

declare(strict_types=1);

namespace App\Services\Calendars;

use App\Exceptions\ApiHttpException;
use App\Models\CalendarInstance;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Sabre\CalDAV\Backend\PDO as CalPDO;
use Sabre\CalDAV\Plugin as CalDAVPlugin;
use Sabre\CalDAV\Xml\Property\SupportedCalendarComponentSet;
use Sabre\DAV\Exception\BadRequest;
use Sabre\DAV\PropPatch;

final class CalendarRepository
{
    /** Sabre CalDAV PDO maps this Apple property onto `calendarinstances.calendarcolor`. */
    private const CALENDAR_COLOR_PROPERTY = '{http://apple.com/ns/ical/}calendar-color';

    public function list(string $username): array
    {
        $instances = CalendarInstance::query()
            ->with('calendar')
            ->where('principaluri', $this->principalUri($username))
            ->whereHas('calendar', fn ($query) => $query->supportsVevent())
            ->orderBy('calendarorder')
            ->orderBy('id')
            ->get();

        return [
            'list' => $instances
                ->map(fn (CalendarInstance $instance): array => $this->mapCalendar($instance))
                ->values()
                ->all(),
        ];
    }

    public function show(string $username, string $calendarId): array
    {
        $instance = $this->findOwnedCalendar($username, $calendarId);
        if ($instance === null) {
            throw new ApiHttpException(404, 'Calendar not found.', 'not_found');
        }

        return $this->mapCalendar($instance);
    }

    public function create(string $username, array $payload): array
    {
        $name = trim((string) ($payload['name'] ?? ''));
        if ($name === '') {
            throw new ApiHttpException(400, 'name is required.', 'bad_request');
        }

        $uri = $this->allocateCalendarUri(
            $username,
            isset($payload['id']) && is_string($payload['id']) ? $payload['id'] : null,
            $name,
        );

        $properties = [
            '{DAV:}displayname' => $name,
            '{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set' => new SupportedCalendarComponentSet(['VEVENT', 'VJOURNAL']),
        ];

        if (array_key_exists('description', $payload)) {
            $description = $payload['description'];
            $properties['{'.CalDAVPlugin::NS_CALDAV.'}calendar-description'] = is_string($description) ? $description : null;
        }
        if (array_key_exists('color', $payload) && is_string($payload['color']) && trim($payload['color']) !== '') {
            $properties[self::CALENDAR_COLOR_PROPERTY] = trim($payload['color']);
        }
        if (array_key_exists('timeZone', $payload) && is_string($payload['timeZone']) && trim($payload['timeZone']) !== '') {
            $properties['{'.CalDAVPlugin::NS_CALDAV.'}calendar-timezone'] = trim($payload['timeZone']);
        }

        try {
            $this->calBackend()->createCalendar($this->principalUri($username), $uri, $properties);
        } catch (BadRequest $exception) {
            throw new ApiHttpException(400, $exception->getMessage(), 'invalidProperties');
        }

        $instance = $this->findOwnedCalendar($username, $uri);
        if ($instance === null) {
            throw new ApiHttpException(500, 'Could not load created calendar.', 'server_error');
        }

        return $this->mapCalendar($instance);
    }

    public function update(string $username, string $calendarId, array $payload): array
    {
        $instance = $this->findOwnedCalendar($username, $calendarId);
        if ($instance === null) {
            throw new ApiHttpException(404, 'Calendar not found.', 'not_found');
        }

        $mutations = [];
        if (array_key_exists('name', $payload)) {
            $name = trim((string) $payload['name']);
            if ($name === '') {
                throw new ApiHttpException(400, 'name must not be empty.', 'invalidProperties');
            }
            $mutations['{DAV:}displayname'] = $name;
        }
        if (array_key_exists('description', $payload)) {
            $description = $payload['description'];
            $mutations['{'.CalDAVPlugin::NS_CALDAV.'}calendar-description'] = is_string($description) ? $description : null;
        }
        if (array_key_exists('color', $payload)) {
            $color = $payload['color'];
            $mutations[self::CALENDAR_COLOR_PROPERTY] = is_string($color) && trim($color) !== '' ? trim($color) : null;
        }
        if (array_key_exists('timeZone', $payload)) {
            $timeZone = $payload['timeZone'];
            $mutations['{'.CalDAVPlugin::NS_CALDAV.'}calendar-timezone'] = is_string($timeZone) && trim($timeZone) !== '' ? trim($timeZone) : null;
        }

        if ($mutations !== []) {
            $propPatch = new PropPatch($mutations);
            $this->calBackend()->updateCalendar($this->calBackendCalendarId($instance), $propPatch);
            $propPatch->commit();
        }

        $instance->refresh();

        return $this->mapCalendar($instance);
    }

    public function delete(string $username, string $calendarId, array $options = []): array
    {
        $instance = $this->findOwnedCalendar($username, $calendarId);
        if ($instance === null) {
            throw new ApiHttpException(404, 'Calendar not found.', 'not_found');
        }

        if ((string) $instance->uri === 'default') {
            throw new ApiHttpException(403, 'The default calendar cannot be deleted.', 'forbidden');
        }

        $removeContents = (bool) ($options['onDestroyRemoveContents'] ?? false);
        if ($instance->objects()->where('componenttype', 'VEVENT')->exists() && ! $removeContents) {
            throw new ApiHttpException(409, 'Calendar contains events.', 'calendarHasContents');
        }

        $this->calBackend()->deleteCalendar($this->calBackendCalendarId($instance));

        return ['ok' => true];
    }

    public function changes(string $username, ?string $since): array
    {
        $instances = CalendarInstance::query()
            ->with('calendar')
            ->where('principaluri', $this->principalUri($username))
            ->whereHas('calendar', fn ($query) => $query->supportsVevent())
            ->orderBy('uri')
            ->get();

        $currentState = $this->computeInstancesState($instances);
        $previous = $this->parseInstancesState($since);

        if ($since === null || $since === '' || $since === '0') {
            return [
                'oldState' => '0',
                'newState' => $currentState,
                'hasMoreChanges' => false,
                'created' => $instances->pluck('uri')->map(fn ($uri): string => (string) $uri)->all(),
                'updated' => [],
                'destroyed' => [],
            ];
        }

        if ($since === $currentState) {
            return ['oldState' => $since, 'newState' => $currentState, 'hasMoreChanges' => false, 'created' => [], 'updated' => [], 'destroyed' => []];
        }

        if ($previous === null) {
            throw new ApiHttpException(400, 'Sync state is invalid or expired.', 'cannotCalculateChanges');
        }

        $currentMap = [];
        foreach ($instances as $instance) {
            $currentMap[(string) $instance->uri] = (int) ($instance->calendar?->synctoken ?? 1);
        }

        $created = [];
        $updated = [];
        foreach ($currentMap as $uri => $token) {
            if (! array_key_exists($uri, $previous)) {
                $created[] = $uri;
            } elseif ($previous[$uri] !== $token) {
                $updated[] = $uri;
            }
        }

        $destroyed = [];
        foreach (array_keys($previous) as $uri) {
            if (! array_key_exists($uri, $currentMap)) {
                $destroyed[] = $uri;
            }
        }

        return ['oldState' => $since, 'newState' => $currentState, 'hasMoreChanges' => false, 'created' => $created, 'updated' => $updated, 'destroyed' => $destroyed];
    }

    private function findOwnedCalendar(string $username, string $calendarId): ?CalendarInstance
    {
        return CalendarInstance::query()
            ->with('calendar')
            ->where('principaluri', $this->principalUri($username))
            ->where('uri', $calendarId)
            ->whereHas('calendar', fn ($query) => $query->supportsVevent())
            ->first();
    }

    private function allocateCalendarUri(string $username, ?string $requestedId, string $name): string
    {
        if ($requestedId !== null && $requestedId !== '') {
            if ($requestedId === 'default' || $this->findOwnedCalendar($username, $requestedId) !== null) {
                throw new ApiHttpException(409, 'Calendar id already exists.', 'alreadyExists');
            }

            return $requestedId;
        }

        $base = Str::slug($name, '-') ?: 'calendar';
        $candidate = $base;
        $suffix = 2;
        while ($this->findOwnedCalendar($username, $candidate) !== null) {
            $candidate = $base.'-'.$suffix;
            $suffix++;
        }

        return $candidate;
    }

    private function computeInstancesState($instances): string
    {
        $parts = [];
        foreach ($instances as $instance) {
            $parts[] = (string) $instance->uri.':'.(int) ($instance->calendar?->synctoken ?? 1);
        }

        return (string) count($parts).':'.implode(',', $parts);
    }

    private function parseInstancesState(?string $state): ?array
    {
        if ($state === null || $state === '' || $state === '0') {
            return [];
        }
        if (! preg_match('/^(\d+):(.+)$/', $state, $matches)) {
            return null;
        }
        $entries = $matches[2] === '' ? [] : explode(',', $matches[2]);
        if (count($entries) !== (int) $matches[1]) {
            return null;
        }
        $map = [];
        foreach ($entries as $entry) {
            $parts = explode(':', $entry, 2);
            if (count($parts) !== 2 || $parts[0] === '' || ! ctype_digit($parts[1])) {
                return null;
            }
            $map[$parts[0]] = (int) $parts[1];
        }

        return $map;
    }

    private function calBackendCalendarId(CalendarInstance $instance): array
    {
        return [(int) $instance->calendarid, (int) $instance->id];
    }

    private function mapCalendar(CalendarInstance $instance): array
    {
        $uri = (string) $instance->uri;
        $name = trim((string) ($instance->displayname ?? ''));
        if ($name === '') {
            $name = $uri;
        }

        $rights = match ((int) ($instance->access ?? 1)) {
            2 => ['mayRead' => true, 'mayWrite' => false, 'mayShare' => false, 'mayDelete' => false],
            3 => ['mayRead' => true, 'mayWrite' => true, 'mayShare' => false, 'mayDelete' => false],
            default => ['mayRead' => true, 'mayWrite' => true, 'mayShare' => false, 'mayDelete' => $uri !== 'default'],
        };

        return [
            'id' => $uri,
            'name' => $name,
            'description' => is_string($instance->description) && trim($instance->description) !== '' ? trim($instance->description) : null,
            'timeZone' => is_string($instance->timezone) && trim($instance->timezone) !== '' ? trim($instance->timezone) : null,
            'color' => is_string($instance->calendarcolor) && trim($instance->calendarcolor) !== '' ? trim($instance->calendarcolor) : null,
            'sortOrder' => (int) ($instance->calendarorder ?? 0),
            'isDefault' => $uri === 'default',
            'isSubscribed' => true,
            'shareWith' => null,
            'myRights' => $rights,
        ];
    }

    private function principalUri(string $username): string
    {
        return 'principals/'.$username;
    }

    private function calBackend(): CalPDO
    {
        return new CalPDO(DB::connection('wgw')->getPdo());
    }
}
