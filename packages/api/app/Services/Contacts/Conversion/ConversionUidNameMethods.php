<?php

declare(strict_types=1);

namespace App\Services\Contacts\Conversion;

use App\Services\VObject\ICalendarDateTime;
use App\Services\VObject\ICalendarUid;
use Illuminate\Support\Str;
use Sabre\VObject\DateTimeParser;
use Sabre\VObject\InvalidDataException;
use Sabre\VObject\Property;

trait ConversionUidNameMethods
{
    public static function generateUid(string $seed): string
    {
        return ICalendarUid::fromSeed($seed);
    }

    /**
     * Canonical group member uid for JSContact and vCard writes.
     *
     * macOS AddressBookCore CardDAV PUT may emit corrupt values such as
     * urn:uuid:"urn:uuid:<uuid>" (double prefix, embedded quotes, line folding).
     */

    public static function normalizeMemberUid(string $memberUid): string
    {
        $memberUid = trim($memberUid);
        if ($memberUid === '') {
            return '';
        }

        $memberUid = self::stripMemberUidQuotes($memberUid);
        $original = $memberUid;

        while (str_starts_with(strtolower($memberUid), 'urn:uuid:')) {
            $rest = substr($memberUid, 9);
            $rest = self::stripMemberUidQuotes(trim($rest));
            if ($rest === '') {
                break;
            }

            if (str_starts_with(strtolower($rest), 'urn:uuid:')
                || preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $rest) === 1) {
                $memberUid = $rest;

                continue;
            }

            return $original;
        }

        if ($memberUid === '') {
            return '';
        }

        if (preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $memberUid) === 1) {
            return 'urn:uuid:'.strtolower($memberUid);
        }

        return $memberUid;
    }

    /**
     * Apple CardDAV group members use urn:uuid: URIs; contact cards often store bare UUIDs.
     * Normalize member references on write so Apple Contacts.app reconciles membership correctly.
     */

    public static function memberUidForVCardWrite(string $memberUid): string
    {
        return self::normalizeMemberUid($memberUid);
    }

    /**
     * Case-insensitive uid comparison key — Apple CardDAV often uses bare UUIDs on cards
     * while group MEMBER / X-ADDRESSBOOKSERVER-MEMBER values use urn:uuid: prefixes.
     */

    public static function normalizeContactUidForMatch(string $uid): string
    {
        $normalized = self::normalizeMemberUid($uid);
        if (str_starts_with(strtolower($normalized), 'urn:uuid:')) {
            return strtolower(substr($normalized, 9));
        }

        return strtolower(trim($normalized));
    }

    private static function stripMemberUidQuotes(string $uid): string
    {
        $previous = null;
        while ($previous !== $uid) {
            $previous = $uid;
            $uid = trim($uid);
            $uid = trim($uid, "\"'");
        }

        return $uid;
    }

    /**
     * @param  array<string, mixed>  $card
     */

    public static function deriveFullName(array $card): string
    {
        $name = $card['name'] ?? null;
        if (! is_array($name)) {
            return '';
        }
        if (isset($name['full']) && is_string($name['full']) && $name['full'] !== '') {
            return $name['full'];
        }
        $components = $name['components'] ?? null;
        if (! is_array($components)) {
            return '';
        }
        $pieces = [];
        $isOrdered = (bool) ($name['isOrdered'] ?? false);
        $unorderedBuckets = [
            'title' => [],
            'given' => [],
            'given2' => [],
            'surname' => [],
            'surname2' => [],
            'generation' => [],
            'credential' => [],
        ];
        $unorderedRemainder = [];
        foreach ($components as $component) {
            if (! is_array($component)) {
                continue;
            }
            if (($component['kind'] ?? '') === 'separator') {
                continue;
            }
            $value = trim((string) ($component['value'] ?? ''));
            if ($value !== '') {
                if ($isOrdered) {
                    $pieces[] = $value;

                    continue;
                }

                $kind = (string) ($component['kind'] ?? '');
                if (isset($unorderedBuckets[$kind])) {
                    $unorderedBuckets[$kind][] = $value;
                } else {
                    $unorderedRemainder[] = $value;
                }
            }
        }

        if (! $isOrdered) {
            foreach ($unorderedBuckets as $bucket) {
                foreach ($bucket as $value) {
                    $pieces[] = $value;
                }
            }
            foreach ($unorderedRemainder as $value) {
                $pieces[] = $value;
            }
        }

        return implode(' ', $pieces);
    }

    /**
     * @param  array<string, mixed>  $object
     * @return array<string, string|list<string>>|null
     */

    public static function vCardParamsFromObject(array $object): ?array
    {
        $params = $object['vCardParams'] ?? null;
        if (! is_array($params) || $params === []) {
            return null;
        }

        /** @var array<string, string|list<string>> $params */
        return $params;
    }

    public static function expertiseLevelFromVCard(string $level): string
    {
        $normalized = strtolower(trim($level));

        return self::EXPERTISE_LEVEL_TO_JS[$normalized] ?? $normalized;
    }

    public static function expertiseLevelToVCard(string $level): string
    {
        $normalized = strtolower(trim($level));

        return self::EXPERTISE_LEVEL_TO_VCARD[$normalized] ?? $normalized;
    }

    /**
     * @return array<string, mixed>|null PartialDate or Timestamp structure
     */

    public static function anniversaryDateFromProperty(Property $property, bool $preferTimestamp): ?array
    {
        $value = trim((string) $property->getValue());
        $valueType = strtolower((string) ($property['VALUE'] ?? $property->getValueType()));
        $calendarScale = isset($property['CALSCALE']) ? strtolower((string) $property['CALSCALE']) : null;

        if ($valueType === 'timestamp' || preg_match('/^\d{8}T\d{6}Z$/', $value) === 1) {
            if ($preferTimestamp) {
                return [
                    '@type' => 'Timestamp',
                    'utc' => self::normalizeUtcDateTime($value),
                ];
            }

            $normalized = self::normalizeUtcDateTime($value);
            if (preg_match('/^(\d{4})-(\d{2})-(\d{2})/', $normalized, $matches) === 1) {
                $date = [
                    '@type' => 'PartialDate',
                    'year' => (int) $matches[1],
                    'month' => (int) $matches[2],
                    'day' => (int) $matches[3],
                ];
                if ($calendarScale !== null && $calendarScale !== '') {
                    $date['calendarScale'] = $calendarScale;
                }

                return $date;
            }
        }

        // Parse all vCard date formats: YYYYMMDD, YYYY-MM-DD (Apple/vCard 3.0),
        // --MMDD, --MM-DD (no-year, RFC 6350 §4.3.1 and Apple extended format).
        try {
            $parts = DateTimeParser::parseVCardDateTime($value);
        } catch (InvalidDataException) {
            return null;
        }

        // Skip values that carry a time component (handled by timestamp branch above).
        if ($parts['hour'] !== null || $parts['minute'] !== null || $parts['second'] !== null) {
            return null;
        }

        // Must have at least month or day to be a useful date entry.
        if ($parts['month'] === null && $parts['date'] === null) {
            return null;
        }

        $date = ['@type' => 'PartialDate'];
        if ($parts['year'] !== null) {
            $date['year'] = (int) $parts['year'];
        }
        if ($parts['month'] !== null) {
            $date['month'] = (int) $parts['month'];
        }
        if ($parts['date'] !== null) {
            $date['day'] = (int) $parts['date'];
        }
        if ($calendarScale !== null && $calendarScale !== '') {
            $date['calendarScale'] = $calendarScale;
        }

        return $date;
    }

    /**
     * @param  array<string, mixed>  $date
     */

    public static function anniversaryDateToVCardValue(array $date, string $propertyName): array
    {
        $type = (string) ($date['@type'] ?? 'PartialDate');
        if ($type === 'Timestamp' && isset($date['utc'])) {
            $params = [];
            if (in_array(strtoupper($propertyName), ['BDAY', 'DEATHDATE'], true)) {
                $params['value'] = 'TIMESTAMP';
            }

            return [self::utcDateTimeToVCard((string) $date['utc']), $params];
        }

        $params = ['value' => 'DATE'];
        if (isset($date['calendarScale']) && is_string($date['calendarScale'])) {
            $params['calscale'] = $date['calendarScale'];
        }

        $month = str_pad((string) ($date['month'] ?? ''), 2, '0', STR_PAD_LEFT);
        $day = str_pad((string) ($date['day'] ?? ''), 2, '0', STR_PAD_LEFT);

        if (! isset($date['year'])) {
            // No-year date: emit --MMDD per RFC 6350 §4.3.1.
            return ['--'.$month.$day, $params];
        }

        $year = str_pad((string) $date['year'], 4, '0', STR_PAD_LEFT);

        return [$year.$month.$day, $params];
    }

    /**
     * @return array<string, mixed>
     */

    public static function placeFromProperty(Property $property): array
    {
        $value = trim((string) $property->getValue());
        $valueType = strtolower((string) ($property['VALUE'] ?? $property->getValueType()));
        $place = ['@type' => 'Address'];

        if ($valueType === 'uri' || str_starts_with(strtolower($value), 'geo:')) {
            $place['coordinates'] = str_starts_with(strtolower($value), 'geo:') ? $value : $value;
        } else {
            $place['full'] = $value;
        }

        return $place;
    }

    /**
     * @return array<string, true>
     */

    public static function relationTypesFromProperty(Property $property): array
    {
        $relations = [];
        foreach (self::typeValues($property) as $type) {
            $normalized = strtolower($type);
            if ($normalized !== '') {
                $relations[$normalized] = true;
            }
        }

        return $relations;
    }

    public static function isUriValue(string $value): bool
    {
        return preg_match('#^[a-z][a-z0-9+.-]*:#i', $value) === 1;
    }

}
