<?php

declare(strict_types=1);

namespace App\Services\Jmap;

use App\Services\Jmap\Blobs\JmapBlobService;

/**
 * JMAP capability URNs, advertised limits, and the session state constant
 * shared by the Session resource (RFC 8620 §2) and the /jmap batch endpoint.
 */
final class JmapCapabilities
{
    public const CORE = 'urn:ietf:params:jmap:core';

    public const CALENDARS = 'urn:ietf:params:jmap:calendars';

    public const CONTACTS = 'urn:ietf:params:jmap:contacts';

    /**
     * Session document version, used as the prefix of the derived session
     * state (JmapCapabilitySet::sessionState()). The full state is this
     * constant plus a digest of the enabled capability URNs, so a feature
     * gate toggling a domain on/off is an observable session change
     * (RFC 8620 §2). Bump the version when the document shape itself changes.
     */
    public const SESSION_STATE = 'wgw-jmap-1';

    public const MAX_CALLS_IN_REQUEST = 32;

    public const MAX_OBJECTS_IN_GET = 500;

    public const MAX_OBJECTS_IN_SET = 200;

    /**
     * RFC 8620 §2 core capability object.
     *
     * @return array<string, mixed>
     */
    public static function coreCapability(): array
    {
        return [
            // Enforced by POST /jmap/upload (JmapBlobService); PHP-level
            // limits (post_max_size) still apply upstream.
            'maxSizeUpload' => JmapBlobService::maxSizeUpload(),
            'maxConcurrentUpload' => 4,
            'maxSizeRequest' => 2_000_000,
            'maxConcurrentRequests' => 4,
            'maxCallsInRequest' => self::MAX_CALLS_IN_REQUEST,
            'maxObjectsInGet' => self::MAX_OBJECTS_IN_GET,
            'maxObjectsInSet' => self::MAX_OBJECTS_IN_SET,
            'collationAlgorithms' => ['i;unicode-casemap'],
        ];
    }

    /**
     * draft-ietf-jmap-calendars-27 §1.5.1 account-level capability object.
     * The session-level value for the calendars URN is the empty object.
     *
     * @return array<string, mixed>
     */
    public static function calendarsAccountCapability(): array
    {
        return [
            // Storage keys each VEVENT object to exactly one calendar.
            'maxCalendarsPerEvent' => 1,
            'minDateTime' => '1970-01-01T00:00:00Z',
            'maxDateTime' => '2100-01-01T00:00:00Z',
            'maxExpandedQueryDuration' => 'P1Y',
            'maxParticipantsPerEvent' => null,
            'mayCreateCalendar' => true,
        ];
    }

    /**
     * RFC 9610 §1.3 account-level capability object. The session-level value
     * for the contacts URN is the empty object.
     *
     * @return array<string, mixed>
     */
    public static function contactsAccountCapability(): array
    {
        return [
            // Storage keys each card to exactly one address book.
            'maxAddressBooksPerCard' => 1,
            'mayCreateAddressBook' => true,
        ];
    }
}
