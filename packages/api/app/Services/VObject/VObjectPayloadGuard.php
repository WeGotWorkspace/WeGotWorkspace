<?php

declare(strict_types=1);

namespace App\Services\VObject;

use App\Exceptions\ApiHttpException;
use Illuminate\Support\Facades\Log;
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

    public function readVCard(string $vcard, string $domain = 'contacts'): VCard
    {
        $this->assertVCardSize($vcard, $domain);

        try {
            $document = Reader::read($vcard);
        } catch (\Throwable) {
            throw new ApiHttpException(400, 'Invalid vCard payload.', 'bad_request');
        }

        if (! $document instanceof VCard) {
            throw new ApiHttpException(400, 'Input is not a vCard document.', 'bad_request');
        }

        $this->assertVCardPropertyCount($document, $domain);

        return $document;
    }

    public function readICalendar(string $ics, string $domain = 'calendars'): VCalendar
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

        $this->assertICalendarComponentCount($document, $domain);

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

    public function assertVCardSize(string $vcard, string $domain = 'contacts'): void
    {
        $bytes = strlen($vcard);
        if ($bytes <= self::MAX_VCARD_BYTES) {
            return;
        }

        $this->logRejectedPayload($domain, 'vcard', $bytes, self::MAX_VCARD_BYTES);

        throw new ApiHttpException(
            413,
            'vCard payload exceeds the maximum allowed size of '.self::MAX_VCARD_BYTES.' bytes.',
            'payload_too_large',
        );
    }

    public function assertIcsSize(string $ics, string $domain = 'calendars'): void
    {
        $bytes = strlen($ics);
        if ($bytes <= self::MAX_ICS_BYTES) {
            return;
        }

        $this->logRejectedPayload($domain, 'ics', $bytes, self::MAX_ICS_BYTES);

        throw new ApiHttpException(
            413,
            'iCalendar payload exceeds the maximum allowed size of '.self::MAX_ICS_BYTES.' bytes.',
            'payload_too_large',
        );
    }

    private function assertVCardPropertyCount(VCard $document, string $domain): void
    {
        $count = iterator_count($document->children());
        if ($count <= self::MAX_VCARD_PROPERTIES) {
            return;
        }

        $this->logRejectedPayload($domain, 'vcard_properties', $count, self::MAX_VCARD_PROPERTIES);

        throw new ApiHttpException(
            400,
            'vCard exceeds the maximum allowed property count of '.self::MAX_VCARD_PROPERTIES.'.',
            'bad_request',
        );
    }

    private function assertICalendarComponentCount(VCalendar $document, string $domain): void
    {
        $count = 0;
        foreach (['VEVENT', 'VTODO', 'VALARM'] as $name) {
            $count += count($document->getComponents($name));
        }

        if ($count <= self::MAX_ICALENDAR_COMPONENTS) {
            return;
        }

        $this->logRejectedPayload($domain, 'ics_components', $count, self::MAX_ICALENDAR_COMPONENTS);

        throw new ApiHttpException(
            400,
            'iCalendar exceeds the maximum allowed component count of '.self::MAX_ICALENDAR_COMPONENTS.'.',
            'bad_request',
        );
    }

    private function logRejectedPayload(string $domain, string $kind, int $actual, int $limit): void
    {
        try {
            Log::warning('vobject_payload_rejected', [
                'domain' => $domain,
                'kind' => $kind,
                'actual' => $actual,
                'limit' => $limit,
            ]);
        } catch (\Throwable) {
            // Logging is optional outside the Laravel container (e.g. unit tests).
        }
    }
}
