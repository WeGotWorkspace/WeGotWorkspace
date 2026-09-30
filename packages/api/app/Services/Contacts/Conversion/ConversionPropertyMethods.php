<?php

declare(strict_types=1);

namespace App\Services\Contacts\Conversion;

use App\Services\VObject\ICalendarDateTime;
use App\Services\VObject\VObjectScalar;
use Sabre\VObject\Property;

final class ConversionPropertyMethods
{
    /** @var array<int, string> */
    private const N_LEGACY_KINDS = ['surname', 'given', 'given2', 'title', 'credential'];

    /** @var array<int, string> */
    private const N_EXTENDED_KINDS = ['surname', 'given', 'given2', 'title', 'credential', 'surname2', 'generation'];

    /** @var array<int, string> */
    private const ADR_LEGACY_KINDS = ['postOfficeBox', 'apartment', 'name', 'locality', 'region', 'postcode', 'country'];

    /** @var array<int, string> */
    private const ADR_RFC9554_KINDS = [
        'postOfficeBox',
        'apartment',
        'name',
        'locality',
        'region',
        'postcode',
        'country',
        'room',
        'floor',
        'apartment',
        'building',
        'block',
        'number',
        'name',
        'direction',
        'landmark',
        'subdistrict',
        'district',
    ];

    /** @var array<string, string> */
    private const TEL_TYPE_TO_FEATURE = [
        'cell' => 'mobile',
        'fax' => 'fax',
        'main-number' => 'main-number',
        'pager' => 'pager',
        'text' => 'text',
        'textphone' => 'textphone',
        'video' => 'video',
        'voice' => 'voice',
    ];

    /** @var array<string, string> */
    private const TEL_FEATURES = [
        'mobile' => 'cell',
        'fax' => 'fax',
        'main-number' => 'main-number',
        'pager' => 'pager',
        'text' => 'text',
        'textphone' => 'textphone',
        'video' => 'video',
        'voice' => 'voice',
    ];

    /** @return array<string, true>|null */
    public static function contextsFromType(Property $property): ?array
    {
        $contexts = [];
        foreach (self::typeValues($property) as $type) {
            $normalized = strtolower($type);
            if ($normalized === 'home') {
                $contexts['private'] = true;
            } elseif ($normalized === 'work') {
                $contexts['work'] = true;
            } elseif ($normalized === 'billing') {
                $contexts['billing'] = true;
            } elseif ($normalized === 'delivery') {
                $contexts['delivery'] = true;
            } elseif ($normalized === 'school') {
                $contexts['school'] = true;
            }
        }

        return $contexts === [] ? null : $contexts;
    }

    /**
     * @return list<string>
     */
    public static function telTypeValues(Property $property): array
    {
        $types = [];
        foreach (self::typeValues($property) as $type) {
            $normalized = strtolower($type);
            if ($normalized === 'home' || $normalized === 'work') {
                continue;
            }
            $types[] = $normalized;
        }

        return $types;
    }

    /**
     * @return array<string, true>|null
     */
    public static function telFeaturesFromProperty(Property $property): ?array
    {
        $features = [];
        foreach (self::telTypeValues($property) as $type) {
            if (isset(self::TEL_TYPE_TO_FEATURE[$type])) {
                $features[self::TEL_TYPE_TO_FEATURE[$type]] = true;
            }
        }

        return $features === [] ? null : $features;
    }

    /**
     * @param  array<string, true>  $features
     * @param  array<mixed>|null  $contexts
     * @return list<string>
     */
    public static function telTypesFromFeatures(array $features, ?array $contexts): array
    {
        $types = [];
        foreach (array_keys($features) as $feature) {
            // RFC 6350 §6.4.1: voice is the default TEL type — omit on write so Apple
            // Address Book does not show a spurious "voice" label alongside home/work.
            if ($feature !== 'voice' && isset(self::TEL_FEATURES[$feature])) {
                $types[] = self::TEL_FEATURES[$feature];
            }
        }
        if ($contexts !== null) {
            if (isset($contexts['private'])) {
                $types[] = 'home';
            }
            if (isset($contexts['work'])) {
                $types[] = 'work';
            }
            if (isset($contexts['school'])) {
                $types[] = 'school';
            }
        }

        return array_values(array_unique($types));
    }

    public static function prefFromProperty(Property $property): ?int
    {
        if (! isset($property['PREF'])) {
            return null;
        }

        return (int) VObjectScalar::string($property['PREF']);
    }

    /**
     * @param  array<string, mixed>  $object
     */
    public static function applySharedFields(array &$object, Property $property): void
    {
        $contexts = self::contextsFromType($property);
        if ($contexts !== null) {
            $object['contexts'] = $contexts;
        }
        $pref = self::prefFromProperty($property);
        if ($pref !== null) {
            $object['pref'] = $pref;
        }
        if (isset($property['LABEL'])) {
            $object['label'] = VObjectScalar::string($property['LABEL']);
        }
    }

    /**
     * @return list<string>
     */
    public static function typeValues(Property $property): array
    {
        if (! isset($property['TYPE'])) {
            return [];
        }

        $raw = VObjectScalar::string($property['TYPE']);

        return array_values(array_filter(array_map('trim', preg_split('/,/', $raw) ?: [])));
    }

    public static function normalizeUtcDateTime(string $value): string
    {
        return strtoupper(ICalendarDateTime::toJmap($value));
    }

    public static function utcDateTimeToVCard(string $value): string
    {
        return strtoupper(ICalendarDateTime::toIcs(ICalendarDateTime::toJmap($value)));
    }

    public static function isDerived(Property $property): bool
    {
        return isset($property['DERIVED']) && strtolower(VObjectScalar::string($property['DERIVED'])) === 'true';
    }

    /**
     * @return list<string>
     */
    public static function structuredParts(Property $property): array
    {
        return array_values($property->getParts());
    }

    /** @param list<string> $parts */
    public static function isRfc9554Adr(array $parts): bool
    {
        return count($parts) >= 17;
    }

    /**
     * @param  list<string>  $parts
     * @return list<array{kind: string, value: string}>
     */
    public static function addressComponentsFromParts(array $parts): array
    {
        if (self::isRfc9554Adr($parts)) {
            return self::addressComponentsFromRfc9554Parts($parts);
        }

        return self::addressComponentsFromLegacyParts($parts);
    }

    /**
     * @param  list<string>  $parts
     * @return list<array{kind: string, value: string}>
     */
    private static function addressComponentsFromLegacyParts(array $parts): array
    {
        $components = [];
        foreach (self::ADR_LEGACY_KINDS as $index => $kind) {
            $value = trim((string) ($parts[$index] ?? ''));
            if ($value === '') {
                continue;
            }
            $components[] = ['@type' => 'AddressComponent', 'kind' => $kind, 'value' => $value];
        }

        return $components;
    }

    /**
     * @param  list<string>  $parts
     * @return list<array{kind: string, value: string}>
     */
    private static function addressComponentsFromRfc9554Parts(array $parts): array
    {
        $hasExtendedStreet = trim((string) ($parts[12] ?? '')) !== ''
            || trim((string) ($parts[13] ?? '')) !== '';
        $components = [];
        foreach (self::ADR_RFC9554_KINDS as $index => $kind) {
            if ($hasExtendedStreet && $index === 2) {
                continue;
            }
            $value = trim((string) ($parts[$index] ?? ''));
            if ($value === '') {
                continue;
            }
            $components[] = ['@type' => 'AddressComponent', 'kind' => $kind, 'value' => $value];
        }

        return $components;
    }

    /**
     * @param  list<array{kind: string, value: string, '@type'?: string}>  $components
     * @return list<string>
     */
    public static function adrPartsFromComponents(array $components, bool $useRfc9554): array
    {
        if ($useRfc9554) {
            $parts = array_fill(0, 18, '');
            foreach ($components as $component) {
                $kind = (string) ($component['kind']);
                $value = (string) ($component['value']);
                $index = array_search($kind, self::ADR_RFC9554_KINDS, true);
                if ($index === false) {
                    continue;
                }
                $parts[$index] = $value;
            }

            return $parts;
        }

        $parts = array_fill(0, 7, '');
        foreach ($components as $component) {
            $kind = (string) ($component['kind']);
            $value = (string) ($component['value']);
            $index = array_search($kind, self::ADR_LEGACY_KINDS, true);
            if ($index === false) {
                if ($kind === 'number' || $kind === 'block' || $kind === 'direction' || $kind === 'landmark' || $kind === 'subdistrict' || $kind === 'district' || $kind === 'room' || $kind === 'floor' || $kind === 'building') {
                    $parts[2] = trim($parts[2].' '.$value);
                }

                continue;
            }
            $parts[$index] = $value;
        }

        return $parts;
    }

    /**
     * Build legacy ADR components when a JSContact address has no `components` array.
     *
     * @param  array<string, mixed>  $entry
     * @return list<array{'@type': string, kind: string, value: string}>
     */
    public static function addressComponentsFromEntry(array $entry): array
    {
        $components = [];
        foreach (self::ADR_LEGACY_KINDS as $kind) {
            if ($kind === 'postOfficeBox' || $kind === 'apartment') {
                continue;
            }
            if (! isset($entry[$kind]) || ! is_string($entry[$kind])) {
                continue;
            }
            $value = trim($entry[$kind]);
            if ($value === '') {
                continue;
            }
            $components[] = ['@type' => 'AddressComponent', 'kind' => $kind, 'value' => $value];
        }

        if ($components !== []) {
            return $components;
        }

        if (isset($entry['full']) && is_string($entry['full'])) {
            $full = trim($entry['full']);
            if ($full !== '') {
                return [['@type' => 'AddressComponent', 'kind' => 'name', 'value' => $full]];
            }
        }

        return [];
    }

    /**
     * @return list<array{'@type': string, kind: string, value: string}>
     */
    public static function nameComponentsFromProperty(Property $property): array
    {
        $parts = self::structuredParts($property);
        $kinds = count($parts) >= 7 ? self::N_EXTENDED_KINDS : self::N_LEGACY_KINDS;
        $components = [];

        foreach ($kinds as $index => $kind) {
            $raw = (string) ($parts[$index] ?? '');
            if ($raw === '') {
                continue;
            }
            foreach (self::splitStructuredValues($raw) as $value) {
                $components[] = ['@type' => 'NameComponent', 'kind' => $kind, 'value' => $value];
            }
        }

        return $components;
    }

    /**
     * @param  list<array{kind: string, value: string, '@type'?: string}>  $components
     * @return list<string>
     */
    public static function nPartsFromComponents(array $components): array
    {
        $parts = array_fill(0, 7, '');
        $buckets = [
            'surname' => 0,
            'given' => 1,
            'given2' => 2,
            'title' => 3,
            'credential' => 4,
            'surname2' => 5,
            'generation' => 6,
        ];

        foreach ($components as $component) {
            $kind = (string) ($component['kind']);
            $value = (string) ($component['value']);
            if ($value === '' || ! isset($buckets[$kind])) {
                continue;
            }
            $index = $buckets[$kind];
            $parts[$index] = $parts[$index] === '' ? $value : $parts[$index].','.$value;
        }

        return $parts;
    }

    /**
     * @return list<string>
     */
    public static function splitStructuredValues(string $raw): array
    {
        return array_values(array_filter(array_map('trim', explode(',', $raw)), static fn (string $value): bool => $value !== ''));
    }

    public static function mediaUriFromProperty(Property $property): string
    {
        if ($property instanceof Property\Binary) {
            $mime = self::mimeTypeFromMediaProperty($property);
            $encoded = base64_encode((string) $property->getValue());

            return 'data:'.$mime.';base64,'.$encoded;
        }

        return trim((string) $property->getValue());
    }

    /**
     * Resolve the MIME type for a binary media property.
     *
     * vCard 4.0 uses MEDIATYPE=image/jpeg; vCard 3.0 (Apple) uses TYPE=JPEG.
     */
    private static function mimeTypeFromMediaProperty(Property $property): string
    {
        if (isset($property['MEDIATYPE'])) {
            return VObjectScalar::string($property['MEDIATYPE']);
        }

        if (isset($property['TYPE'])) {
            $type = strtolower(trim(VObjectScalar::string($property['TYPE'])));
            $known = [
                'jpeg' => 'image/jpeg',
                'jpg' => 'image/jpeg',
                'gif' => 'image/gif',
                'png' => 'image/png',
                'webp' => 'image/webp',
                'bmp' => 'image/bmp',
                'tiff' => 'image/tiff',
                'tif' => 'image/tiff',
                'svg' => 'image/svg+xml',
            ];

            return $known[$type] ?? 'application/octet-stream';
        }

        return 'application/octet-stream';
    }

    /**
     * @return array{0: string, 1: array<string, string|list<string>>}
     */
    public static function jCardTupleFromProperty(Property $property): array
    {
        $params = [];
        foreach ($property->parameters() as $param) {
            $name = strtolower((string) $param->name);
            $values = [];
            foreach ($param->getParts() as $part) {
                $values[] = (string) $part;
            }
            $params[$name] = count($values) === 1 ? $values[0] : $values;
        }

        $valueType = VObjectScalar::parameterOrValueType($property['VALUE'] ?? null, $property->getValueType());

        return [
            strtoupper((string) $property->name),
            $params,
            $valueType,
            $property->getJsonValue(),
        ];
    }

    /**
     * Stable uid for vCard → JSContact 1.0 when UID is absent (RFC 9555 §2.1.1).
     * RFC 9982 §5 forbids generating uid for JSContact 2.0+ in that case.
     */
}
