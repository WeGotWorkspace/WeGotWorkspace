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
     * Increment SEQUENCE only when the iTIP Broker reports a significant
     * organizer change (RFC 5546). Attendee PARTSTAT-only writes and
     * description/color edits keep the existing SEQUENCE.
     */
    public function persistableIcs(string $username, ?string $oldIcs, string $newIcs): string
    {
        if ($oldIcs === null || trim($oldIcs) === '') {
            return $newIcs;
        }
        foreach ($this->brokerMessages($username, $newIcs, $oldIcs) as $message) {
            $method = strtoupper((string) ($message->method ?? ''));
            if (in_array($method, ['REQUEST', 'CANCEL'], true) && $message->significantChange) {
                return $this->incrementSequence($newIcs);
            }
        }

        return $newIcs;
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
        $event = $this->canonicalizeLocalParticipants($event);
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

    /**
     * Rewrite local participants to a stable calendar-user address (usable
     * email or username) so Broker + inbox matching do not depend on a
     * valid mailbox.
     *
     * @param  array<string, mixed>  $event
     * @return array<string, mixed>
     */
    private function canonicalizeLocalParticipants(array $event): array
    {
        $participants = $event['participants'] ?? null;
        if (! is_array($participants) || $participants === []) {
            return $event;
        }

        foreach ($participants as $id => $entry) {
            if (! is_array($entry)) {
                continue;
            }
            $email = $entry['email'] ?? null;
            if (! is_string($email) || trim($email) === '') {
                continue;
            }
            $principal = $this->addresses->principalForMailto($email);
            if ($principal === null) {
                continue;
            }
            $canonical = $this->addresses->canonicalCalendarUserAddress($principal);
            if ($canonical === null) {
                continue;
            }
            $entry['email'] = $canonical;
            $participants[$id] = $entry;
        }
        $event['participants'] = $participants;

        return $event;
    }

    private function schedule(string $username, ?string $newIcs, ?string $oldIcs): void
    {
        $uid = $this->singleEventUid($newIcs ?? $oldIcs);
        DB::connection('wgw')->transaction(function () use ($username, $newIcs, $oldIcs, $uid): void {
            if ($uid !== null && $uid !== '') {
                CalendarObject::query()->where('uid', $uid)->lockForUpdate()->get();
            }
            foreach ($this->brokerMessages($username, $newIcs, $oldIcs) as $message) {
                if (! $this->shouldDeliver($message, $oldIcs)) {
                    continue;
                }
                $this->deliver($username, $message);
            }
        });
    }

    /**
     * @return list<Message>
     */
    private function brokerMessages(string $username, ?string $newIcs, ?string $oldIcs): array
    {
        $actorAddresses = $this->addresses->addressesForUsername($username);
        if ($actorAddresses === []) {
            return [];
        }

        $newIcs = $this->ensureOrganizerIcs($newIcs, $actorAddresses);

        if (! $this->hasSingleEventUid($newIcs) || ! $this->hasSingleEventUid($oldIcs)) {
            return [];
        }

        try {
            /** @var list<Message> $messages */
            $messages = (new Broker)->parseEvent($newIcs, $actorAddresses, $oldIcs);
        } catch (ITipException) {
            return [];
        }

        return $messages;
    }

    private function shouldDeliver(Message $message, ?string $oldIcs): bool
    {
        $method = strtoupper((string) ($message->method ?? ''));
        if ($method === 'REQUEST' && $oldIcs !== null && trim($oldIcs) !== '' && ! $message->significantChange) {
            return false;
        }

        return true;
    }

    private function incrementSequence(string $ics): string
    {
        try {
            $parsed = Reader::read($ics);
        } catch (\Throwable) {
            return $ics;
        }
        if (! $parsed instanceof VCalendar) {
            return $ics;
        }

        foreach ($parsed->select('VEVENT') as $event) {
            $current = isset($event->SEQUENCE) ? (int) $event->SEQUENCE->getValue() : 0;
            $event->SEQUENCE = $current + 1;
        }

        return $parsed->serialize();
    }

    private function singleEventUid(?string $ics): ?string
    {
        if ($ics === null || trim($ics) === '') {
            return null;
        }
        try {
            $parsed = Reader::read($ics);
        } catch (\Throwable) {
            return null;
        }
        if (! $parsed instanceof VCalendar) {
            return null;
        }
        foreach ($parsed->select('VEVENT') as $event) {
            $uid = trim((string) ($event->UID ?? ''));
            if ($uid !== '') {
                return $uid;
            }
        }

        return null;
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

        if ($this->isOrganizerRequestToSelf($message, $recipient)) {
            return;
        }

        $this->deliverLocal($message, (string) $recipient->uri);
    }

    private function isOrganizerRequestToSelf(Message $message, Principal $recipient): bool
    {
        $method = strtoupper((string) ($message->method ?? 'REQUEST'));
        if ($method !== '' && $method !== 'REQUEST') {
            return false;
        }

        $organizerMailto = (string) ($message->sender ?? '');
        $vevent = isset($message->message) ? ($message->message->VEVENT ?? null) : null;
        if ($vevent !== null && isset($vevent->ORGANIZER)) {
            $organizerMailto = (string) $vevent->ORGANIZER;
        }
        $organizer = $this->addresses->principalForMailto($organizerMailto);
        if ($organizer !== null && $organizer->uri === $recipient->uri) {
            return true;
        }

        foreach ($this->addresses->addressesForPrincipal($recipient) as $address) {
            if ($this->addresses->calendarUserAddress($address) === $this->addresses->calendarUserAddress($organizerMailto)
                && $this->addresses->calendarUserAddress($organizerMailto) !== null) {
                return true;
            }
        }

        return false;
    }

    private function deliverLocal(Message $message, string $principalUri): void
    {
        $method = strtoupper((string) ($message->method ?? ''));
        if ($method === 'CANCEL') {
            $this->consumeCancel($principalUri, $message);

            return;
        }

        $this->deleteSchedulingObjectsForUid($principalUri, (string) $message->uid);

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

    /**
     * iTIP CANCEL is consumed automatically: drop inbox REQUEST leftovers and the
     * CANCEL itself, and remove a still-tentative invitee copy. Do not leave a
     * non-actionable CANCEL card in the invitations sidebar.
     */
    private function consumeCancel(string $principalUri, Message $message): void
    {
        $this->deleteSchedulingObjectsForUid($principalUri, (string) $message->uid);

        $existing = $this->findEventByUid($principalUri, (string) $message->uid);
        if ($existing === null) {
            return;
        }

        $raw = is_string($existing->calendardata) ? $existing->calendardata : (string) $existing->calendardata;
        $current = Reader::read($raw);
        $newObject = (new Broker)->processMessage($message, $current);
        $instance = $this->instanceForObject($principalUri, $existing);
        if ($instance === null) {
            return;
        }

        $caldav = $this->calBackend();
        $calendarId = [(int) $instance->calendarid, (int) $instance->id];
        if ($this->isTentativeInviteCopy($raw, $principalUri) || $newObject === null) {
            $caldav->deleteCalendarObject($calendarId, (string) $existing->uri);
            $this->unindexPath($principalUri, (string) $instance->uri, (string) $existing->uri);

            return;
        }

        $caldav->updateCalendarObject($calendarId, (string) $existing->uri, $newObject->serialize());
        $this->indexPath($principalUri, (string) $instance->uri, (string) $existing->uri);
    }

    private function deleteSchedulingObjectsForUid(string $principalUri, string $uid): void
    {
        if ($uid === '') {
            return;
        }
        $caldav = $this->calBackend();
        foreach ($caldav->getSchedulingObjects($principalUri) as $row) {
            $data = is_string($row['calendardata'] ?? null) ? $row['calendardata'] : '';
            if ($data === '' || ! str_contains($data, $uid)) {
                continue;
            }
            try {
                $parsed = Reader::read($data);
            } catch (\Throwable) {
                continue;
            }
            $vevent = $parsed->VEVENT ?? null;
            if ($vevent === null || trim((string) ($vevent->UID ?? '')) !== $uid) {
                continue;
            }
            $caldav->deleteSchedulingObject($principalUri, (string) $row['uri']);
        }
    }

    private function isTentativeInviteCopy(string $ics, string $principalUri): bool
    {
        try {
            $parsed = Reader::read($ics);
        } catch (\Throwable) {
            return false;
        }
        $vevent = $parsed->VEVENT ?? null;
        if ($vevent === null || ! isset($vevent->ATTENDEE)) {
            return false;
        }
        foreach ($vevent->ATTENDEE as $attendee) {
            $principal = $this->addresses->principalForMailto((string) $attendee);
            if ($principal === null || $principal->uri !== $principalUri) {
                continue;
            }
            $status = strtoupper(trim((string) ($attendee['PARTSTAT'] ?? 'NEEDS-ACTION')));

            return in_array($status, ['NEEDS-ACTION', 'TENTATIVE'], true);
        }

        return false;
    }

    private function unindexPath(string $principalUri, string $calendarUri, string $eventUri): void
    {
        $username = str_starts_with($principalUri, 'principals/')
            ? substr($principalUri, strlen('principals/'))
            : $principalUri;
        $davPath = 'calendars/'.$username.'/'.$calendarUri.'/'.$eventUri;
        $this->searchIndexSync->sync(
            'calendars',
            fn () => $this->searchIndexer->deleteDavPath($davPath),
            $davPath,
            $username,
        );
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
