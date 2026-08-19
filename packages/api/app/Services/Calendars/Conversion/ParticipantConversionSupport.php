<?php

declare(strict_types=1);

namespace App\Services\Calendars\Conversion;

use Sabre\VObject\Component\VEvent;
use Sabre\VObject\Property;

/**
 * ORGANIZER / ATTENDEE ↔ JMAP Participant scheduling parameters.
 */
final class ParticipantConversionSupport
{
    /** @var array<string, string> */
    private const ROLE_FROM_ICS = [
        'CHAIR' => 'chair',
        'REQ-PARTICIPANT' => 'attendee',
        'OPT-PARTICIPANT' => 'optional',
        'NON-PARTICIPANT' => 'non-participant',
    ];

    /** @var array<string, string> */
    private const ROLE_TO_ICS = [
        'chair' => 'CHAIR',
        'attendee' => 'REQ-PARTICIPANT',
        'optional' => 'OPT-PARTICIPANT',
        'non-participant' => 'NON-PARTICIPANT',
        'owner' => 'CHAIR',
    ];

    /** @var array<string, string> */
    private const CUTYPE_FROM_ICS = [
        'INDIVIDUAL' => 'individual',
        'GROUP' => 'group',
        'RESOURCE' => 'resource',
        'ROOM' => 'room',
        'UNKNOWN' => 'unknown',
    ];

    /** @var array<string, string> */
    private const CUTYPE_TO_ICS = [
        'individual' => 'INDIVIDUAL',
        'group' => 'GROUP',
        'resource' => 'RESOURCE',
        'room' => 'ROOM',
        'unknown' => 'UNKNOWN',
    ];

    /**
     * @param  array<string, mixed>  $event
     */
    public static function readParticipants(VEvent $vevent, array &$event): void
    {
        $participants = [];
        $index = 0;

        if (isset($vevent->ORGANIZER)) {
            $participants['org'] = self::participantFromProperty($vevent->ORGANIZER, ['owner']);
        }

        if (isset($vevent->ATTENDEE)) {
            foreach ($vevent->ATTENDEE as $attendee) {
                $roles = self::rolesFromProperty($attendee);
                if ($roles === []) {
                    $roles = ['attendee'];
                }
                $participants['att'.(++$index)] = self::participantFromProperty($attendee, $roles);
            }
        }

        if ($participants !== []) {
            $event['participants'] = $participants;
        }
    }

    /**
     * @param  array<string, mixed>  $event
     */
    public static function writeParticipants(VEvent $vevent, array $event): void
    {
        $participants = $event['participants'] ?? null;
        if (! is_array($participants)) {
            return;
        }

        foreach ($participants as $entry) {
            if (! is_array($entry)) {
                continue;
            }
            $email = $entry['email'] ?? null;
            if (! is_string($email) || trim($email) === '') {
                continue;
            }

            $roles = self::roleIds($entry['roles'] ?? null);
            $params = [];
            if (isset($entry['name']) && is_string($entry['name']) && trim($entry['name']) !== '') {
                $params['CN'] = trim($entry['name']);
            }

            $address = str_starts_with($email, 'mailto:') ? $email : 'mailto:'.$email;

            if (in_array('owner', $roles, true)) {
                $vevent->add('ORGANIZER', $address, $params);

                continue;
            }

            self::applyAttendeeParams($params, $entry, $roles);
            $vevent->add('ATTENDEE', $address, $params);
        }
    }

    /**
     * @param  list<string>  $roles
     * @return array<string, mixed>
     */
    private static function participantFromProperty(Property $property, array $roles): array
    {
        $entry = [
            '@type' => 'Participant',
            'name' => self::participantNameFromProperty($property),
            'email' => self::emailFromCalAddress((string) $property->getValue()),
            'roles' => $roles,
        ];

        if (isset($property['PARTSTAT'])) {
            $partstat = strtolower(trim((string) $property['PARTSTAT']));
            if ($partstat !== '') {
                $entry['participationStatus'] = $partstat;
            }
        }

        if (isset($property['ROLE'])) {
            $mappedRole = self::ROLE_FROM_ICS[strtoupper(trim((string) $property['ROLE']))] ?? null;
            if ($mappedRole !== null && ! in_array($mappedRole, $entry['roles'], true)) {
                $entry['roles'][] = $mappedRole;
            }
        }

        if (isset($property['CUTYPE'])) {
            $kind = self::CUTYPE_FROM_ICS[strtoupper(trim((string) $property['CUTYPE']))] ?? null;
            if ($kind !== null) {
                $entry['kind'] = $kind;
            }
        }

        if (isset($property['RSVP'])) {
            $entry['expectReply'] = strtoupper(trim((string) $property['RSVP'])) === 'TRUE';
        }

        if (isset($property['LANGUAGE'])) {
            $language = trim((string) $property['LANGUAGE']);
            if ($language !== '') {
                $entry['language'] = $language;
            }
        }

        if (isset($property['DELEGATED-TO'])) {
            $delegatedTo = self::emailFromCalAddress((string) $property['DELEGATED-TO']);
            if ($delegatedTo !== null) {
                $entry['delegatedTo'] = $delegatedTo;
            }
        }

        if (isset($property['DELEGATED-FROM'])) {
            $delegatedFrom = self::emailFromCalAddress((string) $property['DELEGATED-FROM']);
            if ($delegatedFrom !== null) {
                $entry['delegatedFrom'] = $delegatedFrom;
            }
        }

        return $entry;
    }

    /**
     * @param  array<string, string>  $params
     * @param  array<string, mixed>  $entry
     * @param  list<string>  $roles
     */
    private static function applyAttendeeParams(array &$params, array $entry, array $roles): void
    {
        if (isset($entry['participationStatus']) && is_string($entry['participationStatus'])) {
            $params['PARTSTAT'] = strtoupper($entry['participationStatus']);
        }

        $role = self::primaryRoleForIcs($roles);
        if ($role !== null) {
            $params['ROLE'] = $role;
        }

        if (isset($entry['kind']) && is_string($entry['kind'])) {
            $cutype = self::CUTYPE_TO_ICS[strtolower($entry['kind'])] ?? null;
            if ($cutype !== null) {
                $params['CUTYPE'] = $cutype;
            }
        }

        if (isset($entry['expectReply'])) {
            $params['RSVP'] = ($entry['expectReply'] === true) ? 'TRUE' : 'FALSE';
        }

        if (isset($entry['language']) && is_string($entry['language']) && trim($entry['language']) !== '') {
            $params['LANGUAGE'] = trim($entry['language']);
        }

        if (isset($entry['delegatedTo']) && is_string($entry['delegatedTo']) && trim($entry['delegatedTo']) !== '') {
            $delegatedTo = trim($entry['delegatedTo']);
            $params['DELEGATED-TO'] = str_starts_with($delegatedTo, 'mailto:')
                ? $delegatedTo
                : 'mailto:'.$delegatedTo;
        }

        if (isset($entry['delegatedFrom']) && is_string($entry['delegatedFrom']) && trim($entry['delegatedFrom']) !== '') {
            $delegatedFrom = trim($entry['delegatedFrom']);
            $params['DELEGATED-FROM'] = str_starts_with($delegatedFrom, 'mailto:')
                ? $delegatedFrom
                : 'mailto:'.$delegatedFrom;
        }
    }

    /**
     * JSCalendar {@code roles} is a map ({@code {owner: true}}); REST tests and
     * ICS round-trips also send a list ({@code ['owner']}).
     *
     * @return list<string>
     */
    public static function roleIds(mixed $roles): array
    {
        if (! is_array($roles) || $roles === []) {
            return [];
        }
        if (array_is_list($roles)) {
            $ids = [];
            foreach ($roles as $role) {
                if (is_string($role) && $role !== '') {
                    $ids[] = $role;
                }
            }

            return $ids;
        }

        $ids = [];
        foreach ($roles as $role => $enabled) {
            if ($enabled === true && is_string($role) && $role !== '') {
                $ids[] = $role;
            }
        }

        return $ids;
    }

    /**
     * @param  list<string>  $roles
     */
    private static function primaryRoleForIcs(array $roles): ?string
    {
        foreach (['chair', 'optional', 'non-participant', 'attendee'] as $role) {
            if (in_array($role, $roles, true)) {
                return self::ROLE_TO_ICS[$role];
            }
        }

        return null;
    }

    /**
     * @return list<string>
     */
    private static function rolesFromProperty(Property $property): array
    {
        if (! isset($property['ROLE'])) {
            return [];
        }

        $mapped = self::ROLE_FROM_ICS[strtoupper(trim((string) $property['ROLE']))] ?? null;

        return $mapped !== null ? [$mapped] : [];
    }

    private static function participantNameFromProperty(Property $property): ?string
    {
        if (isset($property['CN'])) {
            $name = trim((string) $property['CN']);
            if ($name !== '') {
                return $name;
            }
        }

        return null;
    }

    private static function emailFromCalAddress(string $value): ?string
    {
        $value = trim($value);
        if (str_starts_with(strtolower($value), 'mailto:')) {
            return substr($value, 7);
        }

        return $value !== '' ? $value : null;
    }
}
