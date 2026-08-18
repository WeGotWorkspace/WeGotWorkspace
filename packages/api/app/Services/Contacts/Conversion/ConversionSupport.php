<?php

declare(strict_types=1);

namespace App\Services\Contacts\Conversion;

use App\Services\VObject\ICalendarDateTime;
use App\Services\VObject\ICalendarUid;
use Illuminate\Support\Str;
use Sabre\VObject\DateTimeParser;
use Sabre\VObject\InvalidDataException;
use Sabre\VObject\Property;

/**
 * Shared helpers for RFC 9555 vCard ↔ JSContact conversion.
 *
 * uid rules for JSContact 2.0 are updated by RFC 9982; see docs/contacts/rfc9982-conversion-matrix.md.
 */
final class ConversionSupport
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

    /** @var array<string, true> */
    private const KNOWN_VCARD_PROPERTIES = [
        'UID' => true,
        'KIND' => true,
        'FN' => true,
        'N' => true,
        'NICKNAME' => true,
        'PHOTO' => true,
        'EMAIL' => true,
        'TEL' => true,
        'ADR' => true,
        'ORG' => true,
        'TITLE' => true,
        'ROLE' => true,
        'NOTE' => true,
        'CATEGORIES' => true,
        'MEMBER' => true,
        'PRODID' => true,
        'CREATED' => true,
        'REV' => true,
        'LANGUAGE' => true,
        'LOGO' => true,
        'SOUND' => true,
        'URL' => true,
        'CONTACT-URI' => true,
        'LANG' => true,
        'IMPP' => true,
        'SOCIALPROFILE' => true,
        'KEY' => true,
        'CALADRURI' => true,
        'CALURI' => true,
        'FBURL' => true,
        'GEO' => true,
        'TZ' => true,
        'GRAMGENDER' => true,
        'PRONOUNS' => true,
        'BDAY' => true,
        'BIRTHPLACE' => true,
        'DEATHDATE' => true,
        'DEATHPLACE' => true,
        'ANNIVERSARY' => true,
        'EXPERTISE' => true,
        'HOBBY' => true,
        'INTEREST' => true,
        'ORG-DIRECTORY' => true,
        'SOURCE' => true,
        'RELATED' => true,
        'X-ABLABEL' => true,
    ];

    /** @var array<string, true> */
    private const PRESERVE_VCARD_PROPERTIES = [
        'VERSION' => true,
        'CLIENTPIDMAP' => true,
        'GENDER' => true,
        'XML' => true,
    ];

    /** @var array<string, string> */
    private const EXPERTISE_LEVEL_TO_JS = [
        'beginner' => 'low',
        'average' => 'medium',
        'expert' => 'high',
    ];

    /** @var array<string, string> */
    private const EXPERTISE_LEVEL_TO_VCARD = [
        'low' => 'beginner',
        'medium' => 'average',
        'high' => 'expert',
    ];

    public static function isKnownVCardProperty(string $name): bool
    {
        return isset(self::KNOWN_VCARD_PROPERTIES[strtoupper($name)]);
    }

    public static function shouldPreserveVCardProperty(string $name): bool
    {
        return isset(self::PRESERVE_VCARD_PROPERTIES[strtoupper($name)]);
    }

    /** @var list<string> */
    public const CARD_ID_MAP_FIELDS = [
        'emails',
        'phones',
        'addresses',
        'organizations',
        'notes',
        'media',
        'nicknames',
        'titles',
        'links',
        'preferredLanguages',
        'onlineServices',
        'anniversaries',
        'directories',
        'personalInfo',
        'cryptoKeys',
        'calendars',
        'schedulingAddresses',
    ];

    /** @var list<string> */
    public const CARD_PATCH_ID_KEYED_MAP_FIELDS = [
        ...self::CARD_ID_MAP_FIELDS,
        'keywords',
        'members',
        'addressBookIds',
        'relatedTo',
    ];

    /**
     * Apple-style group vCards use `FN` plus `N:GroupName;;;;`. After a partial
     * name patch (`name.full` only), stale `name.components` would otherwise
     * round-trip as an outdated structured `N` while `FN` updates.
     *
     * @param  array<string, mixed>  $card
     * @return array<string, mixed>
     */
    public static function syncGroupDisplayName(array $card): array
    {
        if (strtolower((string) ($card['kind'] ?? '')) !== 'group') {
            return $card;
        }

        if (! is_array($card['name'] ?? null)) {
            return $card;
        }

        $full = trim((string) ($card['name']['full'] ?? ''));
        if ($full === '') {
            return $card;
        }

        $card['name']['@type'] = 'Name';
        $card['name']['isOrdered'] = false;
        $card['name']['components'] = [
            [
                '@type' => 'NameComponent',
                'kind' => 'surname',
                'value' => $full,
            ],
        ];

        return $card;
    }

    /**
     * Deep-merge a PATCH body into an existing JSContact Card shape.
     *
     * Id-keyed maps merge by entry id; null removes an entry. Nested objects (e.g. name)
     * merge recursively. Scalar top-level fields are replaced.
     *
     * @param  array<string, mixed>  $existing
     * @param  array<string, mixed>  $patch
     * @return array<string, mixed>
     */
    public static function deepMergeContactCardPatch(array $existing, array $patch): array
    {
        $result = $existing;

        foreach ($patch as $key => $value) {
            if ($key === 'speakToAs' && is_array($value)) {
                $baseSpeakToAs = is_array($result['speakToAs'] ?? null) ? $result['speakToAs'] : [];
                if (isset($value['pronouns']) && is_array($value['pronouns'])) {
                    $baseSpeakToAs['pronouns'] = self::mergeIdKeyedMap(
                        is_array($baseSpeakToAs['pronouns'] ?? null) ? $baseSpeakToAs['pronouns'] : [],
                        $value['pronouns'],
                    );
                    $rest = $value;
                    unset($rest['pronouns']);
                    $result['speakToAs'] = $rest === []
                        ? $baseSpeakToAs
                        : self::deepMergeContactCardPatch($baseSpeakToAs, $rest);
                } else {
                    $result['speakToAs'] = self::deepMergeContactCardPatch($baseSpeakToAs, $value);
                }

                continue;
            }

            if (self::isPatchIdKeyedMapField((string) $key) && is_array($value)) {
                $result[$key] = self::mergeIdKeyedMap(
                    is_array($result[$key] ?? null) ? $result[$key] : [],
                    $value,
                );

                continue;
            }

            if (is_array($value)
                && isset($result[$key])
                && is_array($result[$key])
                && ! array_is_list($value)) {
                $result[$key] = self::deepMergeContactCardPatch($result[$key], $value);

                continue;
            }

            $result[$key] = $value;
        }

        return $result;
    }

    /**
     * @param  array<string, mixed>  $existing
     * @param  array<string, mixed>  $patch
     * @return array<string, mixed>
     */
    public static function mergeIdKeyedMap(array $existing, array $patch): array
    {
        $result = $existing;

        foreach ($patch as $id => $entry) {
            $mapKey = (string) $id;
            if ($entry === null) {
                unset($result[$mapKey]);

                continue;
            }

            if (is_array($entry) && isset($result[$mapKey]) && is_array($result[$mapKey])) {
                $result[$mapKey] = self::deepMergeContactCardPatch($result[$mapKey], $entry);
            } else {
                $result[$mapKey] = $entry;
            }
        }

        return $result;
    }

    public static function isPatchIdKeyedMapField(string $field): bool
    {
        return in_array($field, self::CARD_PATCH_ID_KEYED_MAP_FIELDS, true);
    }

    public static function isValidJsContactId(string $id): bool
    {
        return $id !== '' && preg_match('/^[A-Za-z0-9_-]+$/', $id) === 1;
    }

    public static function isUuidPropId(string $id): bool
    {
        return preg_match(
            '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i',
            $id,
        ) === 1;
    }

    public static function isHashFallbackPropId(string $id): bool
    {
        return str_starts_with($id, 'p_') && self::isValidJsContactId($id);
    }

    public static function generatePropId(): string
    {
        return (string) Str::uuid();
    }

    public static function propertyId(Property $property, int $index): string
    {
        if (isset($property['PROP-ID'])) {
            return (string) $property['PROP-ID'];
        }

        return self::fallbackPropertyId($property, strtoupper((string) $property->name), $index);
    }

    /**
     * Legacy vCards without RFC 9554 PROP-ID: deterministic hash over property identity.
     * Same vCard bytes always yield the same map key on read.
     */
    public static function fallbackPropertyId(Property $property, string $propertyName, int $index): string
    {
        $seed = strtoupper($propertyName)
            ."\0"
            .$index
            ."\0"
            .self::propertyFingerprint($property);
        $hash = hash('sha256', $seed, true);

        return 'p_'.rtrim(strtr(base64_encode(substr($hash, 0, 18)), '+/', '-_'), '=');
    }

    /**
     * @param  array<string, mixed>  $card
     * @param  array<string, mixed>|null  $existingCard
     * @return array<string, mixed>
     */
    public static function normalizeCardMapKeys(array $card, ?array $existingCard = null): array
    {
        $existingKeys = self::collectCardMapKeys($existingCard);

        foreach (self::CARD_ID_MAP_FIELDS as $field) {
            if (! isset($card[$field]) || ! is_array($card[$field])) {
                continue;
            }
            $card[$field] = self::normalizeMapKeys($card[$field], $existingKeys[$field] ?? []);
        }

        $speakToAs = $card['speakToAs'] ?? null;
        if (is_array($speakToAs) && isset($speakToAs['pronouns']) && is_array($speakToAs['pronouns'])) {
            $speakToAs['pronouns'] = self::normalizeMapKeys(
                $speakToAs['pronouns'],
                $existingKeys['speakToAs.pronouns'] ?? [],
            );
            $card['speakToAs'] = $speakToAs;
        }

        return $card;
    }

    /**
     * @param  array<string, mixed>  $map
     * @param  array<string, true>  $existingKeys
     * @return array<string, mixed>
     */
    public static function normalizeMapKeys(array $map, array $existingKeys = []): array
    {
        $normalized = [];
        foreach ($map as $key => $entry) {
            if (! is_array($entry)) {
                continue;
            }
            $id = self::resolveMapEntryId(is_string($key) ? $key : '', $existingKeys);
            $normalized[$id] = $entry;
        }

        return $normalized;
    }

    /**
     * @param  array<string, true>  $existingKeys
     */
    public static function resolveMapEntryId(string $key, array $existingKeys = []): string
    {
        if ($key !== ''
            && self::isValidJsContactId($key)
            && (self::isUuidPropId($key) || self::isHashFallbackPropId($key) || isset($existingKeys[$key]))) {
            return $key;
        }

        return self::generatePropId();
    }

    /**
     * @param  array<string, mixed>|null  $card
     * @return array<string, array<string, true>>
     */
    public static function collectCardMapKeys(?array $card): array
    {
        if ($card === null) {
            return [];
        }

        $keys = [];
        foreach (self::CARD_ID_MAP_FIELDS as $field) {
            if (! isset($card[$field]) || ! is_array($card[$field])) {
                continue;
            }
            $keys[$field] = array_fill_keys(array_map('strval', array_keys($card[$field])), true);
        }

        if (isset($card['speakToAs']['pronouns']) && is_array($card['speakToAs']['pronouns'])) {
            $keys['speakToAs.pronouns'] = array_fill_keys(
                array_map('strval', array_keys($card['speakToAs']['pronouns'])),
                true,
            );
        }

        return $keys;
    }

    private static function propertyFingerprint(Property $property): string
    {
        $params = [];
        foreach ($property->parameters() as $parameter) {
            $name = strtoupper((string) $parameter->name);
            if ($name === 'PROP-ID') {
                continue;
            }
            $values = [];
            foreach ($parameter->getParts() as $part) {
                $values[] = (string) $part;
            }
            sort($values);
            $params[$name] = $values;
        }
        ksort($params);

        return json_encode([
            'params' => $params,
            'value' => $property->getJsonValue(),
            'valueType' => strtolower((string) ($property['VALUE'] ?? $property->getValueType())),
        ], JSON_THROW_ON_ERROR);
    }

    /**
     * @return array<string, true>|null
     */
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
     * @return list<string>
     */
    public static function telTypesFromFeatures(array $features, ?array $contexts): array
    {
        $types = [];
        foreach ($features as $feature => $enabled) {
            // RFC 6350 §6.4.1: voice is the default TEL type — omit on write so Apple
            // Address Book does not show a spurious "voice" label alongside home/work.
            if ($enabled && $feature !== 'voice' && isset(self::TEL_FEATURES[$feature])) {
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

        return (int) (string) $property['PREF'];
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
            $object['label'] = (string) $property['LABEL'];
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

        $raw = (string) $property['TYPE'];

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
        return isset($property['DERIVED']) && strtolower((string) $property['DERIVED']) === 'true';
    }

    /**
     * @return list<string>
     */
    public static function structuredParts(Property $property): array
    {
        return $property->getParts();
    }

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
     * @param  list<array{kind: string, value: string, @type?: string}>  $components
     * @return list<string>
     */
    public static function adrPartsFromComponents(array $components, bool $useRfc9554): array
    {
        if ($useRfc9554) {
            $parts = array_fill(0, 18, '');
            foreach ($components as $component) {
                $kind = (string) ($component['kind'] ?? '');
                $value = (string) ($component['value'] ?? '');
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
            $kind = (string) ($component['kind'] ?? '');
            $value = (string) ($component['value'] ?? '');
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
     * @return list<array{@type: string, kind: string, value: string}>
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
     * @return list<array{@type: string, kind: string, value: string}>
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
     * @param  list<array{kind: string, value: string, @type?: string}>  $components
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
            $kind = (string) ($component['kind'] ?? '');
            $value = (string) ($component['value'] ?? '');
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
            return (string) $property['MEDIATYPE'];
        }

        if (isset($property['TYPE'])) {
            $type = strtolower(trim((string) $property['TYPE']));
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

        $valueType = strtolower((string) ($property['VALUE'] ?? $property->getValueType()));

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
