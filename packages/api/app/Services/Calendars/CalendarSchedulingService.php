<?php

declare(strict_types=1);

namespace App\Services\Calendars;

use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use App\Models\Principal;
use App\Services\Calendars\Conversion\ParticipantConversionSupport;
use App\Services\Search\BestEffortSearchIndexSync;
use App\Services\Search\SearchIndexerService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Sabre\CalDAV\Backend\PDO as CalPDO;
use Sabre\VObject\Component\VCalendar;
use Sabre\VObject\ITip\Broker;
use Sabre\VObject\ITip\ITipException;
use Sabre\VObject\ITip\Message;
use Sabre\VObject\Reader;

/**
 * Runs {@see Broker} after REST/JMAP event writes and delivers local iTIP
 * (scheduling inbox + default-calendar copy). External mailto is not emailed here.
 */
final class CalendarSchedulingService
{
    public function __construct(
        private readonly CalendarPrincipalAddresses $addresses,
        private readonly SearchIndexerService $searchIndexer,
        private readonly BestEffortSearchIndexSync $searchIndexSync,
        private readonly CalendarImipService $imip,
    ) {}

    public function scheduleAfterWrite(string $username, ?string $oldIcs, string $newIcs): void
    {
        $this->schedule($username, $newIcs, $oldIcs);
    }

    public function scheduleAfterDelete(string $username, string $oldIcs): void
    {
        $this->schedule($username, null, $oldIcs);
    }

    /**
     * Ensure a VEVENT with attendees has an ORGANIZER for the acting user.
     * UI payloads often send JSCalendar {@code roles: {owner: true}} without a
     * list-shaped owner, or omit the organizer when session email is empty.
     *
     * @param  array<string, mixed>  $event
     * @return array<string, mixed>
     */
    public function withOrganizer(string $username, array $event): array
    {
        $participants = $event['participants'] ?? null;
        if (! is_array($participants) || $participants === []) {
            return $event;
        }
        foreach ($participants as $entry) {
            if (! is_array($entry)) {
                continue;
            }
            if (in_array('owner', ParticipantConversionSupport::roleIds($entry['roles'] ?? null), true)) {
                return $event;
            }
        }
        $addresses = $this->addresses->addressesForUsername($username);
        if ($addresses === []) {
            return $event;
        }
        $email = $this->addresses->calendarUserAddress($addresses[0]);
        if ($email === null) {
            return $event;
        }
        $principal = Principal::forUsername($username);
        $name = trim((string) ($principal?->displayname ?? ''));
        $event['participants'] = [
            'org' => [
                '@type' => 'Participant',
                'email' => $email,
                'name' => $name !== '' ? $name : $username,
                'roles' => ['owner'],
                'participationStatus' => 'accepted',
            ],
            ...$participants,
        ];

        return $event;
    }

    private function schedule(string $username, ?string $newIcs, ?string $oldIcs): void
    {
        $actorAddresses = $this->addresses->addressesForUsername($username);
        if ($actorAddresses === []) {
            return;
        }

        $newIcs = $this->ensureOrganizerIcs($newIcs, $actorAddresses);

        if (! $this->hasSingleEventUid($newIcs) || ! $this->hasSingleEventUid($oldIcs)) {
            return;
        }

        $broker = new Broker;
        try {
            $messages = $broker->parseEvent($newIcs, $actorAddresses, $oldIcs);
        } catch (ITipException) {
            return;
        }
        foreach ($messages as $message) {
            $this->deliver($username, $message);
        }
    }

    /**
     * @param  list<string>  $actorAddresses
     */
    private function ensureOrganizerIcs(?string $ics, array $actorAddresses): ?string
    {
        if ($ics === null || trim($ics) === '' || $actorAddresses === []) {
            return $ics;
        }

        try {
            $parsed = Reader::read($ics);
        } catch (\Throwable) {
            return $ics;
        }
        if (! $parsed instanceof VCalendar) {
            return $ics;
        }

        $changed = false;
        foreach ($parsed->select('VEVENT') as $event) {
            if (isset($event->ORGANIZER) || ! isset($event->ATTENDEE)) {
                continue;
            }
            $event->add('ORGANIZER', $actorAddresses[0]);
            $changed = true;
        }

        return $changed ? $parsed->serialize() : $ics;
    }

    private function hasSingleEventUid(?string $ics): bool
    {
        if ($ics === null || trim($ics) === '') {
            return true;
        }

        try {
            $parsed = Reader::read($ics);
        } catch (\Throwable) {
            return false;
        }
        if (! $parsed instanceof VCalendar) {
            return false;
        }

        $uids = [];
        foreach ($parsed->select('VEVENT') as $event) {
            $uid = (string) ($event->UID ?? '');
            if ($uid === '') {
                continue;
            }
            $uids[$uid] = true;
        }

        return count($uids) <= 1;
    }

    private function deliver(string $username, Message $message): void
    {
        $recipient = $this->addresses->principalForMailto((string) $message->recipient);
        if ($recipient === null) {
            $this->imip->deliver($username, $message);

            return;
        }

        $this->deliverLocal($message, (string) $recipient->uri);
    }

    private function deliverLocal(Message $message, string $principalUri): void
    {
        $caldav = $this->calBackend();
        $objectUri = 'sabredav-'.Str::uuid()->toString().'.ics';
        $payload = $message->message->serialize();
        $caldav->createSchedulingObject($principalUri, $objectUri, $payload);

        $existing = $this->findEventByUid($principalUri, (string) $message->uid);
        $current = null;
        if ($existing !== null) {
            $raw = is_string($existing->calendardata) ? $existing->calendardata : (string) $existing->calendardata;
            $current = Reader::read($raw);
        }

        $newObject = (new Broker)->processMessage($message, $current);
        if ($newObject === null) {
            return;
        }

        $serialized = $newObject->serialize();
        if ($existing !== null) {
            $instance = $this->instanceForObject($principalUri, $existing);
            if ($instance === null) {
                return;
            }
            $caldav->updateCalendarObject(
                [(int) $instance->calendarid, (int) $instance->id],
                (string) $existing->uri,
                $serialized,
            );
            $this->indexPath($principalUri, (string) $instance->uri, (string) $existing->uri);
        } else {
            $instance = $this->defaultCalendarInstance($principalUri);
            if ($instance === null) {
                return;
            }
            $eventUri = 'invite-'.Str::uuid()->toString().'.ics';
            $caldav->createCalendarObject(
                [(int) $instance->calendarid, (int) $instance->id],
                $eventUri,
                $serialized,
            );
            $this->indexPath($principalUri, (string) $instance->uri, $eventUri);
        }
    }

    private function findEventByUid(string $principalUri, string $uid): ?CalendarObject
    {
        if ($uid === '') {
            return null;
        }

        return CalendarObject::query()
            ->where('uid', $uid)
            ->whereHas('calendar.instances', function ($query) use ($principalUri): void {
                $query->where('principaluri', $principalUri);
            })
            ->first();
    }

    private function instanceForObject(string $principalUri, CalendarObject $object): ?CalendarInstance
    {
        return CalendarInstance::query()
            ->where('calendarid', (int) $object->calendarid)
            ->where('principaluri', $principalUri)
            ->first();
    }

    private function defaultCalendarInstance(string $principalUri): ?CalendarInstance
    {
        return CalendarInstance::query()
            ->where('principaluri', $principalUri)
            ->where('uri', CalendarCollectionUris::EVENT_DEFAULT)
            ->first();
    }

    private function indexPath(string $principalUri, string $calendarUri, string $eventUri): void
    {
        $username = str_starts_with($principalUri, 'principals/')
            ? substr($principalUri, strlen('principals/'))
            : $principalUri;
        $davPath = 'calendars/'.$username.'/'.$calendarUri.'/'.$eventUri;
        $this->searchIndexSync->sync(
            'calendars',
            fn () => $this->searchIndexer->indexCalendarObjectFromPath($davPath),
            $davPath,
            $username,
        );
    }

    private function calBackend(): CalPDO
    {
        return new CalPDO(DB::connection('wgw')->getPdo());
    }
}
