<?php

declare(strict_types=1);

namespace App\Services\VObject;

use App\Exceptions\ApiHttpException;
use Illuminate\Support\Facades\Log;
use Sabre\VObject\Component;
use Sabre\VObject\Component\VCalendar;
use Sabre\VObject\Component\VCard;
use Sabre\VObject\Reader;

/**
 * Domain limits for ICS/vCard blobs before Sabre VObject parse (DoS hardening).
 */
final class VObjectPayloadGuard
{
    /** 512 KiB — aligned with docs collaboration markdown cap order-of-magnitude. */
    public const MAX_VCARD_BYTES = 524_288;

    public const MAX_ICS_BYTES = 524_288;

    /** VEVENT + VTODO + VALARM combined per iCalendar object. */
    public const MAX_ICALENDAR_COMPONENTS = 64;

    public const MAX_VCARD_PROPERTIES = 512;

    public function readVCard(string $vcard, string $domain = 'contacts', string $logLevel = 'warning'): VCard
    {
        $this->assertVCardSize($vcard, $domain, $logLevel);

        try {
            $document = Reader::read($vcard);
        } catch (\Throwable) {
            throw new ApiHttpException(400, 'Invalid vCard payload.', 'bad_request');
        }

        if (! $document instanceof VCard) {
            throw new ApiHttpException(400, 'Input is not a vCard document.', 'bad_request');
        }

        $this->assertVCardPropertyCount($document, $domain, $logLevel);

        return $document;
    }

    public function readICalendar(string $ics, string $domain = 'calendars', string $logLevel = 'warning'): VCalendar
    {
        $this->assertIcsSize($ics, $domain, $logLevel);

        try {
            $document = Reader::read($ics);
        } catch (\Throwable) {
            throw new ApiHttpException(400, 'Invalid iCalendar payload.', 'bad_request');
        }

        if (! $document instanceof VCalendar) {
            throw new ApiHttpException(400, 'Input is not an iCalendar document.', 'bad_request');
        }

        $this->assertICalendarComponentCount($document, $domain, $logLevel);

        return $document;
    }

    /**
     * Remote ICS / webcal feeds are size-capped but may contain more VEVENTs
     * than a user-uploaded object (holiday / team calendars).
     */
    public function readICalendarFeed(string $ics, string $domain = 'calendars'): VCalendar
    {
        $this->assertIcsSize($ics, $domain);

        try {
            $document = Reader::read($ics);
        } catch (\Throwable) {
            throw new ApiHttpException(400, 'Invalid iCalendar payload.', 'bad_request');
        }

        if (! $document instanceof VCalendar) {
            throw new ApiHttpException(400, 'Input is not an iCalendar document.', 'bad_request');
        }

        return $document;
    }

    public function assertVCardSize(string $vcard, string $domain = 'contacts', string $logLevel = 'warning'): void
    {
        $bytes = strlen($vcard);
        if ($bytes <= self::MAX_VCARD_BYTES) {
            return;
        }

        $this->logRejectedPayload($domain, 'vcard', $bytes, self::MAX_VCARD_BYTES, $logLevel);

        throw new ApiHttpException(
            413,
            'vCard payload exceeds the maximum allowed size of '.self::MAX_VCARD_BYTES.' bytes.',
            'payload_too_large',
        );
    }

    public function assertIcsSize(string $ics, string $domain = 'calendars', string $logLevel = 'warning'): void
    {
        $bytes = strlen($ics);
        if ($bytes <= self::MAX_ICS_BYTES) {
            return;
        }

        $this->logRejectedPayload($domain, 'ics', $bytes, self::MAX_ICS_BYTES, $logLevel);

        throw new ApiHttpException(
            413,
            'iCalendar payload exceeds the maximum allowed size of '.self::MAX_ICS_BYTES.' bytes.',
            'payload_too_large',
        );
    }

    public static function isPayloadBoundError(ApiHttpException $e): bool
    {
        if ($e->errorCode() === 'payload_too_large') {
            return true;
        }

        if ($e->errorCode() !== 'bad_request') {
            return false;
        }

        $message = $e->getMessage();

        return str_contains($message, 'maximum allowed component count')
            || str_contains($message, 'maximum allowed property count');
    }

    private function assertVCardPropertyCount(VCard $document, string $domain, string $logLevel): void
    {
        $count = iterator_count($document->children());
        if ($count <= self::MAX_VCARD_PROPERTIES) {
            return;
        }

        $this->logRejectedPayload($domain, 'vcard_properties', $count, self::MAX_VCARD_PROPERTIES, $logLevel);

        throw new ApiHttpException(
            400,
            'vCard exceeds the maximum allowed property count of '.self::MAX_VCARD_PROPERTIES.'.',
            'bad_request',
        );
    }

    private function assertICalendarComponentCount(VCalendar $document, string $domain, string $logLevel): void
    {
        $count = $this->countNestedICalendarComponents($document);
        if ($count <= self::MAX_ICALENDAR_COMPONENTS) {
            return;
        }

        $this->logRejectedPayload($domain, 'ics_components', $count, self::MAX_ICALENDAR_COMPONENTS, $logLevel);

        throw new ApiHttpException(
            400,
            'iCalendar exceeds the maximum allowed component count of '.self::MAX_ICALENDAR_COMPONENTS.'.',
            'bad_request',
        );
    }

    /**
     * Combined nested count of VEVENT, VTODO, and VALARM only.
     * VTIMEZONE / STANDARD / DAYLIGHT are ignored.
     */
    private function countNestedICalendarComponents(Component $component): int
    {
        $count = 0;
        foreach ($component->children() as $child) {
            if (! $child instanceof Component) {
                continue;
            }
            $name = strtoupper((string) $child->name);
            if ($name === 'VEVENT' || $name === 'VTODO' || $name === 'VALARM') {
                $count++;
            }
            if ($name === 'VEVENT' || $name === 'VTODO' || $name === 'VCALENDAR') {
                $count += $this->countNestedICalendarComponents($child);
            }
        }

        return $count;
    }

    private function logRejectedPayload(
        string $domain,
        string $kind,
        int $actual,
        int $limit,
        string $logLevel = 'warning',
    ): void {
        $payload = [
            'domain' => $domain,
            'kind' => $kind,
            'actual' => $actual,
            'limit' => $limit,
        ];

        try {
            if ($logLevel === 'debug') {
                Log::debug('vobject_payload_rejected', $payload);
            } else {
                Log::warning('vobject_payload_rejected', $payload);
            }
        } catch (\Throwable) {
            // Logging is optional outside the Laravel container (e.g. unit tests).
        }
    }
}
