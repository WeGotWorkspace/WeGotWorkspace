<?php

declare(strict_types=1);

namespace App\Services\Contacts\Conversion;

use App\Services\VObject\VObjectScalar;
use Illuminate\Support\Str;
use Sabre\VObject\Property;

final class ConversionIdMethods
{
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
            return VObjectScalar::string($property['PROP-ID']);
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
            $id = self::resolveMapEntryId($key, $existingKeys);
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
            'valueType' => VObjectScalar::parameterOrValueType($property['VALUE'] ?? null, $property->getValueType()),
        ], JSON_THROW_ON_ERROR);
    }

    /**
     * @return array<string, true>|null
     */
}
