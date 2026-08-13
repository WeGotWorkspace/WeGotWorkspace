<?php

declare(strict_types=1);

namespace App\Services\Calendars;

use App\Http\Support\OptimisticConcurrency;
use App\Models\CalendarObject;
use App\Services\Calendars\Conversion\CalendarConversionSupport;
use App\Services\Calendars\Conversion\ICalendarJmapEventConverter;
use Illuminate\Support\Str;

final class CalendarEventMapper
{
    public function __construct(
        private readonly ICalendarJmapEventConverter $converter = new ICalendarJmapEventConverter,
        private readonly JmapCalendarEventStateService $eventStates = new JmapCalendarEventStateService,
    ) {}

    /**
     * @return list<array<string, mixed>>
     */
    public function toCalendarEvents(CalendarObject $object, string $calendarUri, ?string $username = null): array
    {
        $raw = is_string($object->calendardata) ? $object->calendardata : (string) $object->calendardata;
        $events = $this->converter->eventsFromIcs($raw);
        $objectId = self::eventIdFromUri((string) $object->uri);
        $multi = count($events) > 1;
        $etag = OptimisticConcurrency::formatEtag(is_string($object->etag) ? $object->etag : null);

        return array_map(function (array $event) use ($object, $calendarUri, $objectId, $multi, $etag, $username): array {
            $uid = is_string($event['uid'] ?? null) ? $event['uid'] : '';
            $event['id'] = $multi && $uid !== ''
                ? CalendarConversionSupport::compositeEventId($objectId, $uid)
                : $objectId;
            $event['calendarIds'] = [$calendarUri => true];

            if ($etag !== null) {
                $event['etag'] = $etag;
            }

            $lastModified = (int) ($object->lastmodified ?? 0);
            if ($lastModified > 0) {
                $timestamp = gmdate('Y-m-d\TH:i:s\Z', $lastModified);
                if (! isset($event['updated']) || ! is_string($event['updated']) || $event['updated'] === '') {
                    $event['updated'] = $timestamp;
                }
                if (! isset($event['created']) || ! is_string($event['created']) || $event['created'] === '') {
                    $event['created'] = $timestamp;
                }
            }

            if ($username !== null) {
                $event = $this->eventStates->attachStateToken($username, $event, $object, $calendarUri);
            }

            return $event;
        }, $events);
    }

    /**
     * @return array<string, mixed>
     */
    public function toCalendarEvent(
        CalendarObject $object,
        string $calendarUri,
        ?string $veventUid = null,
        ?string $username = null,
    ): array {
        $events = $this->toCalendarEvents($object, $calendarUri, $username);
        if ($veventUid !== null) {
            foreach ($events as $event) {
                if (($event['uid'] ?? '') === $veventUid) {
                    return $event;
                }
            }

            throw new \RuntimeException('VEVENT '.$veventUid.' not found in calendar object.');
        }

        return $events[0];
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    public function toIcs(array $payload): string
    {
        return $this->converter->icsFromEvent($payload);
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    public function updateIcs(string $existingIcs, array $payload, ?string $targetVeventUid): string
    {
        if ($targetVeventUid !== null) {
            return $this->converter->updateVEventInIcs($existingIcs, $payload, $targetVeventUid);
        }

        return $this->converter->icsFromEvent($payload);
    }

    public function removeVEventFromIcs(string $ics, string $targetVeventUid): ?string
    {
        return $this->converter->removeVEventFromIcs($ics, $targetVeventUid);
    }

    public static function eventIdFromUri(string $uri): string
    {
        return str_ends_with($uri, '.ics')
            ? substr($uri, 0, -4)
            : $uri;
    }

    public static function eventUriFromId(string $eventId): string
    {
        $parsed = CalendarConversionSupport::parseEventId($eventId);

        return str_ends_with($parsed['objectId'], '.ics')
            ? $parsed['objectId']
            : $parsed['objectId'].'.ics';
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    public static function generateEventUri(array $payload): string
    {
        $base = CalendarConversionSupport::deriveTitle($payload);
        $slug = strtolower(trim(preg_replace('/[^a-z0-9]+/i', '-', $base) ?? '', '-'));
        if ($slug === '') {
            $slug = 'event';
        }

        $suffix = substr(str_replace('-', '', (string) Str::uuid()), 0, 8);

        return $slug.'-'.$suffix.'.ics';
    }
}
