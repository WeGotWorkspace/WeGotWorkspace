<?php

declare(strict_types=1);

namespace App\Services\Contacts\Conversion;

use Sabre\VObject\Property;

/**
 * Shared helpers for RFC 9555 vCard ↔ JSContact conversion.
 * uid rules for JSContact 2.0 are updated by RFC 9982; see docs/contacts/rfc9982-conversion-matrix.md.
 */
final class ConversionSupport
{
    public static function isKnownVCardProperty(string $name): bool
    {
        return ConversionIdMethods::isKnownVCardProperty($name);
    }

    public static function shouldPreserveVCardProperty(string $name): bool
    {
        return ConversionIdMethods::shouldPreserveVCardProperty($name);
    }

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
        return ConversionIdMethods::syncGroupDisplayName($card);
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
        return ConversionIdMethods::deepMergeContactCardPatch($existing, $patch);
    }

    /**
     * @param  array<string, mixed>  $existing
     * @param  array<string, mixed>  $patch
     * @return array<string, mixed>
     */
    public static function mergeIdKeyedMap(array $existing, array $patch): array
    {
        return ConversionIdMethods::mergeIdKeyedMap($existing, $patch);
    }

    public static function isPatchIdKeyedMapField(string $field): bool
    {
        return ConversionIdMethods::isPatchIdKeyedMapField($field);
    }

    public static function isValidJsContactId(string $id): bool
    {
        return ConversionIdMethods::isValidJsContactId($id);
    }

    public static function isUuidPropId(string $id): bool
    {
        return ConversionIdMethods::isUuidPropId($id);
    }

    public static function isHashFallbackPropId(string $id): bool
    {
        return ConversionIdMethods::isHashFallbackPropId($id);
    }

    public static function generatePropId(): string
    {
        return ConversionIdMethods::generatePropId();
    }

    public static function propertyId(Property $property, int $index): string
    {
        return ConversionIdMethods::propertyId($property, $index);
    }

    /**
     * Legacy vCards without RFC 9554 PROP-ID: deterministic hash over property identity.
     * Same vCard bytes always yield the same map key on read.
     */
    public static function fallbackPropertyId(Property $property, string $propertyName, int $index): string
    {
        return ConversionIdMethods::fallbackPropertyId($property, $propertyName, $index);
    }

    /**
     * @param  array<string, mixed>  $card
     * @param  array<string, mixed>|null  $existingCard
     * @return array<string, mixed>
     */
    public static function normalizeCardMapKeys(array $card, ?array $existingCard = null): array
    {
        return ConversionIdMethods::normalizeCardMapKeys($card, $existingCard);
    }

    /**
     * @param  array<string, mixed>  $map
     * @param  array<string, true>  $existingKeys
     * @return array<string, mixed>
     */
    public static function normalizeMapKeys(array $map, array $existingKeys = []): array
    {
        return ConversionIdMethods::normalizeMapKeys($map, $existingKeys);
    }

    /**
     * @param  array<string, true>  $existingKeys
     */
    public static function resolveMapEntryId(string $key, array $existingKeys = []): string
    {
        return ConversionIdMethods::resolveMapEntryId($key, $existingKeys);
    }

    /**
     * @param  array<string, mixed>|null  $card
     * @return array<string, array<string, true>>
     */
    public static function collectCardMapKeys(?array $card): array
    {
        return ConversionIdMethods::collectCardMapKeys($card);
    }

    /** @return array<string, true>|null */
    public static function contextsFromType(Property $property): ?array
    {
        return ConversionPropertyMethods::contextsFromType($property);
    }

    /**
     * @return list<string>
     */
    public static function telTypeValues(Property $property): array
    {
        return ConversionPropertyMethods::telTypeValues($property);
    }

    /**
     * @return array<string, true>|null
     */
    public static function telFeaturesFromProperty(Property $property): ?array
    {
        return ConversionPropertyMethods::telFeaturesFromProperty($property);
    }

    /**
     * @param  array<string, true>  $features
     * @param  array<mixed>|null  $contexts
     * @return list<string>
     */
    public static function telTypesFromFeatures(array $features, ?array $contexts): array
    {
        return ConversionPropertyMethods::telTypesFromFeatures($features, $contexts);
    }

    public static function prefFromProperty(Property $property): ?int
    {
        return ConversionPropertyMethods::prefFromProperty($property);
    }

    /**
     * @param  array<string, mixed>  $object
     */
    public static function applySharedFields(array &$object, Property $property): void
    {
        ConversionPropertyMethods::applySharedFields($object, $property);
    }

    /**
     * @return list<string>
     */
    public static function typeValues(Property $property): array
    {
        return ConversionPropertyMethods::typeValues($property);
    }

    public static function normalizeUtcDateTime(string $value): string
    {
        return ConversionPropertyMethods::normalizeUtcDateTime($value);
    }

    public static function utcDateTimeToVCard(string $value): string
    {
        return ConversionPropertyMethods::utcDateTimeToVCard($value);
    }

    public static function isDerived(Property $property): bool
    {
        return ConversionPropertyMethods::isDerived($property);
    }

    /**
     * @return list<string>
     */
    public static function structuredParts(Property $property): array
    {
        return ConversionPropertyMethods::structuredParts($property);
    }

    /** @param list<string> $parts */
    public static function isRfc9554Adr(array $parts): bool
    {
        return ConversionPropertyMethods::isRfc9554Adr($parts);
    }

    /**
     * @param  list<string>  $parts
     * @return list<array{kind: string, value: string}>
     */
    public static function addressComponentsFromParts(array $parts): array
    {
        return ConversionPropertyMethods::addressComponentsFromParts($parts);
    }

    /**
     * @param  list<array{kind: string, value: string, '@type'?: string}>  $components
     * @return list<string>
     */
    public static function adrPartsFromComponents(array $components, bool $useRfc9554): array
    {
        return ConversionPropertyMethods::adrPartsFromComponents($components, $useRfc9554);
    }

    /**
     * Build legacy ADR components when a JSContact address has no `components` array.
     *
     * @param  array<string, mixed>  $entry
     * @return list<array{'@type': string, kind: string, value: string}>
     */
    public static function addressComponentsFromEntry(array $entry): array
    {
        return ConversionPropertyMethods::addressComponentsFromEntry($entry);
    }

    /**
     * @return list<array{'@type': string, kind: string, value: string}>
     */
    public static function nameComponentsFromProperty(Property $property): array
    {
        return ConversionPropertyMethods::nameComponentsFromProperty($property);
    }

    /**
     * @param  list<array{kind: string, value: string, '@type'?: string}>  $components
     * @return list<string>
     */
    public static function nPartsFromComponents(array $components): array
    {
        return ConversionPropertyMethods::nPartsFromComponents($components);
    }

    /**
     * @return list<string>
     */
    public static function splitStructuredValues(string $raw): array
    {
        return ConversionPropertyMethods::splitStructuredValues($raw);
    }

    public static function mediaUriFromProperty(Property $property): string
    {
        return ConversionPropertyMethods::mediaUriFromProperty($property);
    }

    /**
     * @return array{0: string, 1: array<string, string|list<string>>}
     */
    public static function jCardTupleFromProperty(Property $property): array
    {
        return ConversionPropertyMethods::jCardTupleFromProperty($property);
    }

    public static function generateUid(string $seed): string
    {
        return ConversionUidNameMethods::generateUid($seed);
    }

    /**
     * Canonical group member uid for JSContact and vCard writes.
     *
     * macOS AddressBookCore CardDAV PUT may emit corrupt values such as
     * urn:uuid:"urn:uuid:<uuid>" (double prefix, embedded quotes, line folding).
     */
    public static function normalizeMemberUid(string $memberUid): string
    {
        return ConversionUidNameMethods::normalizeMemberUid($memberUid);
    }

    /**
     * Apple CardDAV group members use urn:uuid: URIs; contact cards often store bare UUIDs.
     * Normalize member references on write so Apple Contacts.app reconciles membership correctly.
     */
    public static function memberUidForVCardWrite(string $memberUid): string
    {
        return ConversionUidNameMethods::memberUidForVCardWrite($memberUid);
    }

    /**
     * Case-insensitive uid comparison key — Apple CardDAV often uses bare UUIDs on cards
     * while group MEMBER / X-ADDRESSBOOKSERVER-MEMBER values use urn:uuid: prefixes.
     */
    public static function normalizeContactUidForMatch(string $uid): string
    {
        return ConversionUidNameMethods::normalizeContactUidForMatch($uid);
    }

    /**
     * @param  array<string, mixed>  $card
     */
    public static function deriveFullName(array $card): string
    {
        return ConversionUidNameMethods::deriveFullName($card);
    }

    /**
     * @param  array<string, mixed>  $object
     * @return array<string, string|list<string>>|null
     */
    public static function vCardParamsFromObject(array $object): ?array
    {
        return ConversionUidNameMethods::vCardParamsFromObject($object);
    }

    public static function expertiseLevelFromVCard(string $level): string
    {
        return ConversionUidNameMethods::expertiseLevelFromVCard($level);
    }

    public static function expertiseLevelToVCard(string $level): string
    {
        return ConversionUidNameMethods::expertiseLevelToVCard($level);
    }

    /**
     * @return array<string, mixed>|null PartialDate or Timestamp structure
     */
    public static function anniversaryDateFromProperty(Property $property, bool $preferTimestamp): ?array
    {
        return ConversionUidNameMethods::anniversaryDateFromProperty($property, $preferTimestamp);
    }

    /**
     * @param  array<string, mixed>  $date
     * @return array{0: string, 1: array<string, string>}
     */
    public static function anniversaryDateToVCardValue(array $date, string $propertyName): array
    {
        return ConversionUidNameMethods::anniversaryDateToVCardValue($date, $propertyName);
    }

    /**
     * @return array<string, mixed>
     */
    public static function placeFromProperty(Property $property): array
    {
        return ConversionUidNameMethods::placeFromProperty($property);
    }

    /**
     * @return array<string, true>
     */
    public static function relationTypesFromProperty(Property $property): array
    {
        return ConversionUidNameMethods::relationTypesFromProperty($property);
    }

    public static function isUriValue(string $value): bool
    {
        return ConversionUidNameMethods::isUriValue($value);
    }
}
