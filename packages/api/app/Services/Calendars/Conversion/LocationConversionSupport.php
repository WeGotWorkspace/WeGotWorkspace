<?php

declare(strict_types=1);

namespace App\Services\Calendars\Conversion;

use Sabre\VObject\Component\VEvent;
use Sabre\VObject\Property;

/**
 * LOCATION, GEO, URL / CONFERENCE / X-GOOGLE-CONFERENCE, ATTACH ↔ JMAP locations, links, attachments.
 *
 * Write-set from `links`: URL + RFC 7986 CONFERENCE + X-GOOGLE-CONFERENCE.
 * Read also maps X-MICROSOFT-SKYPETEAMSMEETINGURL. That Microsoft property is never written.
 */
final class LocationConversionSupport
{
    public const CONFERENCE = 'CONFERENCE';

    public const X_GOOGLE_CONFERENCE = 'X-GOOGLE-CONFERENCE';

    public const X_MICROSOFT_SKYPE_TEAMS_MEETING_URL = 'X-MICROSOFT-SKYPETEAMSMEETINGURL';

    /** Read priority: CONFERENCE, URL, X-GOOGLE-CONFERENCE, X-MICROSOFT-SKYPETEAMSMEETINGURL. */
    private const CONFERENCE_READ_PROPERTIES = [
        self::CONFERENCE,
        'URL',
        self::X_GOOGLE_CONFERENCE,
        self::X_MICROSOFT_SKYPE_TEAMS_MEETING_URL,
    ];

    /** @var list<string> */
    public const CONFERENCE_WRITE_SKIP_ICS_PROPS = [
        self::CONFERENCE,
        self::X_GOOGLE_CONFERENCE,
        self::X_MICROSOFT_SKYPE_TEAMS_MEETING_URL,
    ];

    public const CONFERENCE_LABEL = 'WeGotWorkspace Meet';

    /**
     * @param  array<string, mixed>  $event
     */
    public static function readLocationsAndLinks(VEvent $vevent, array &$event): void
    {
        if (isset($vevent->LOCATION)) {
            $location = trim((string) $vevent->LOCATION->getValue());
            if ($location !== '') {
                $entry = [
                    '@type' => 'Location',
                    'name' => $location,
                ];
                if (isset($vevent->LOCATION['ALTREP'])) {
                    $altrep = trim((string) $vevent->LOCATION['ALTREP']);
                    if ($altrep !== '') {
                        $entry['description'] = $altrep;
                    }
                }
                $event['locations'] = ['loc1' => $entry];
            }
        }

        if (isset($vevent->GEO)) {
            $coordinates = self::coordinatesFromGeoProperty($vevent->GEO);
            if ($coordinates !== null) {
                if (! isset($event['locations'])) {
                    $event['locations'] = ['loc1' => ['@type' => 'Location']];
                }
                $event['locations']['loc1']['coordinates'] = $coordinates;
            }
        }

        $href = self::conferenceHrefFromVEvent($vevent);
        if ($href !== null) {
            $link = [
                '@type' => 'Link',
                'href' => $href,
            ];
            if (isset($vevent->URL['VALUE']) && strtoupper((string) $vevent->URL['VALUE']) === 'URI') {
                $link['contentType'] = 'text/uri-list';
            }
            $event['links'] = ['link1' => $link];
        }

        $attachments = [];
        $attachIndex = 0;
        foreach ($vevent->select('ATTACH') as $attach) {
            if (! $attach instanceof Property) {
                continue;
            }
            $value = trim((string) $attach->getValue());
            if ($value === '') {
                continue;
            }
            $attachment = [
                '@type' => 'Link',
                'href' => $value,
                'rel' => 'enclosure',
            ];
            if (isset($attach['FMTTYPE'])) {
                $attachment['contentType'] = trim((string) $attach['FMTTYPE']);
            }
            $attachments['attach'.(++$attachIndex)] = $attachment;
        }
        if ($attachments !== []) {
            $event['attachments'] = $attachments;
        }
    }

    /**
     * @param  array<string, mixed>  $event
     */
    public static function writeLocationsAndLinks(VEvent $vevent, array $event): void
    {
        $locations = $event['locations'] ?? null;
        if (is_array($locations)) {
            foreach ($locations as $entry) {
                if (! is_array($entry)) {
                    continue;
                }

                $name = isset($entry['name']) && is_string($entry['name']) ? trim($entry['name']) : '';
                $description = isset($entry['description']) && is_string($entry['description'])
                    ? trim($entry['description'])
                    : '';
                $rel = isset($entry['rel']) && is_string($entry['rel']) ? strtolower(trim($entry['rel'])) : '';

                if ($name === '' && $description !== '') {
                    $name = $description;
                }

                if ($name !== '') {
                    $params = [];
                    if ($description !== '' && $description !== $name) {
                        $params['ALTREP'] = $description;
                    }
                    $vevent->add('LOCATION', $name, $params);
                }

                if (isset($entry['coordinates']) && is_string($entry['coordinates'])) {
                    $geo = self::geoValueFromCoordinates($entry['coordinates']);
                    if ($geo !== null) {
                        $vevent->add('GEO', $geo);
                    }
                }

                if ($rel === 'virtual' && $name !== '' && ! isset($vevent->URL)) {
                    $vevent->add('URL', $name);
                }

                break;
            }
        }

        $href = self::firstLinkHref($event);
        if ($href !== '') {
            if (! isset($vevent->URL)) {
                $vevent->add('URL', $href);
            }
            $vevent->add(self::CONFERENCE, $href, [
                'VALUE' => 'URI',
                'FEATURE' => 'VIDEO',
                'LABEL' => self::CONFERENCE_LABEL,
            ]);
            $vevent->add(self::X_GOOGLE_CONFERENCE, $href);
        }

        $attachments = $event['attachments'] ?? null;
        if (is_array($attachments)) {
            foreach ($attachments as $attachment) {
                if (! is_array($attachment)) {
                    continue;
                }
                $href = isset($attachment['href']) && is_string($attachment['href'])
                    ? trim($attachment['href'])
                    : '';
                if ($href === '') {
                    continue;
                }
                $params = [];
                if (isset($attachment['contentType']) && is_string($attachment['contentType'])) {
                    $params['FMTTYPE'] = trim($attachment['contentType']);
                }
                $vevent->add('ATTACH', $href, $params);
            }
        }
    }

    public static function conferenceHrefFromVEvent(VEvent $vevent): ?string
    {
        foreach (self::CONFERENCE_READ_PROPERTIES as $name) {
            foreach ($vevent->select($name) as $property) {
                if (! $property instanceof Property) {
                    continue;
                }
                $href = trim((string) $property->getValue());
                if ($href !== '') {
                    return $href;
                }
            }
        }

        return null;
    }

    /**
     * @param  array<string, mixed>  $event
     */
    public static function firstLinkHref(array $event): string
    {
        $links = $event['links'] ?? null;
        if (! is_array($links)) {
            return '';
        }
        foreach ($links as $link) {
            if (! is_array($link)) {
                continue;
            }
            $href = isset($link['href']) && is_string($link['href']) ? trim($link['href']) : '';
            if ($href !== '') {
                return $href;
            }
        }

        return '';
    }

    public static function isConferenceIcsProp(string $name): bool
    {
        return in_array(strtoupper($name), self::CONFERENCE_WRITE_SKIP_ICS_PROPS, true);
    }

    private static function coordinatesFromGeoProperty(Property $geo): ?string
    {
        $value = trim((string) $geo->getValue());
        if ($value === '') {
            return null;
        }

        if (str_starts_with(strtolower($value), 'geo:')) {
            return $value;
        }

        $parts = explode(';', $value);
        if (count($parts) === 2) {
            return 'geo:'.$parts[0].';'.$parts[1];
        }

        return $value;
    }

    private static function geoValueFromCoordinates(string $coordinates): ?string
    {
        $trimmed = trim($coordinates);
        if ($trimmed === '') {
            return null;
        }

        if (str_starts_with(strtolower($trimmed), 'geo:')) {
            $trimmed = substr($trimmed, 4);
        }

        $parts = explode(';', $trimmed);
        if (count($parts) === 2) {
            return $parts[0].';'.$parts[1];
        }

        $commaParts = explode(',', $trimmed);
        if (count($commaParts) === 2) {
            return $commaParts[0].';'.$commaParts[1];
        }

        return null;
    }
}
