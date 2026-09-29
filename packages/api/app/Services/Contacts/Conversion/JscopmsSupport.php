<?php

declare(strict_types=1);

namespace App\Services\Contacts\Conversion;

use App\Services\VObject\VObjectScalar;
use Sabre\VObject\Property;

/**
 * RFC 9555 §3.3.1 / RFC 9982 JSCOMPS parameter encoding for Name and Address.
 */
final class JscopmsSupport
{
    /** @var array<string, int> */
    private const N_KIND_TO_INDEX = [
        'surname' => 0,
        'given' => 1,
        'given2' => 2,
        'title' => 3,
        'credential' => 4,
        'surname2' => 5,
        'generation' => 6,
    ];

    /** @var array<string, int> */
    private const ADR_RFC9554_KIND_TO_INDEX = [
        'postOfficeBox' => 0,
        'apartment' => 1,
        'name' => 2,
        'locality' => 3,
        'region' => 4,
        'postcode' => 5,
        'country' => 6,
        'room' => 7,
        'floor' => 8,
        'building' => 9,
        'block' => 10,
        'number' => 11,
        'direction' => 12,
        'landmark' => 13,
        'subdistrict' => 14,
        'district' => 15,
    ];

    /**
     * @return array{components: list<array<string, mixed>>, isOrdered: bool, defaultSeparator?: string}
     */
    public static function nameComponentsFromProperty(Property $property): array
    {
        if (! isset($property['JSCOMPS'])) {
            return [
                'components' => ConversionSupport::nameComponentsFromProperty($property),
                'isOrdered' => false,
            ];
        }

        return self::componentsFromJscopms(
            $property,
            ConversionSupport::structuredParts($property),
            self::N_KIND_TO_INDEX,
            'NameComponent',
        );
    }

    /**
     * @return array{components: list<array<string, mixed>>, isOrdered: bool, defaultSeparator?: string}
     */
    public static function addressComponentsFromProperty(Property $property): array
    {
        $parts = ConversionSupport::structuredParts($property);
        if (! isset($property['JSCOMPS'])) {
            return [
                'components' => ConversionSupport::addressComponentsFromParts($parts),
                'isOrdered' => false,
            ];
        }

        return self::componentsFromJscopms(
            $property,
            $parts,
            self::ADR_RFC9554_KIND_TO_INDEX,
            'AddressComponent',
        );
    }

    /**
     * @param  list<array{kind: string, value: string, '@type'?: string}>  $components
     */
    public static function shouldEmitJscopms(array $components, bool $isOrdered, bool $useRfc9554): bool
    {
        return $isOrdered;
    }

    /**
     * @param  list<array{kind: string, value: string, '@type'?: string}>  $components
     * @return array<string, string>
     */
    public static function jscopmsParamsFromComponents(
        array $components,
        bool $useRfc9554,
        ?string $defaultSeparator = null,
    ): array {
        $kindToIndex = $useRfc9554 ? self::ADR_RFC9554_KIND_TO_INDEX : self::N_KIND_TO_INDEX;
        $entries = [];
        $defaultSep = $defaultSeparator ?? '';
        if ($defaultSep !== '') {
            $entries[] = self::encodeSeparator($defaultSep);
        } else {
            $entries[] = '';
        }

        $skipLegacyStreet = $useRfc9554 && self::hasExtendedStreetComponents($components);
        $positionCounts = [];
        foreach ($components as $component) {
            $kind = (string) $component['kind'];
            $value = (string) $component['value'];
            if ($kind === 'separator') {
                $entries[] = self::encodeSeparator($value);

                continue;
            }
            if ($value === '' || ! isset($kindToIndex[$kind])) {
                continue;
            }
            $index = $kindToIndex[$kind];
            if ($skipLegacyStreet && $index === 2) {
                continue;
            }
            $subIndex = $positionCounts[$index] ?? 0;
            $positionCounts[$index] = $subIndex + 1;
            $entries[] = $subIndex === 0 ? (string) $index : $index.','.$subIndex;
        }

        if (count($entries) <= 1) {
            return [];
        }

        return ['jscomps' => implode(';', $entries)];
    }

    /**
     * @param  list<array{kind: string, value: string, '@type'?: string}>  $components
     */
    private static function hasExtendedStreetComponents(array $components): bool
    {
        foreach ($components as $component) {
            $kind = (string) $component['kind'];
            if (in_array($kind, ['number', 'block', 'building', 'room', 'floor', 'direction', 'landmark', 'subdistrict', 'district'], true)) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param  list<string>  $parts
     * @param  array<string, int>  $kindToIndex
     * @return array{components: list<array<string, mixed>>, isOrdered: bool, defaultSeparator?: string}
     */
    private static function componentsFromJscopms(
        Property $property,
        array $parts,
        array $kindToIndex,
        string $componentType,
    ): array {
        $raw = VObjectScalar::string($property['JSCOMPS']);
        $raw = trim($raw, '"');
        $entries = array_map('trim', explode(';', $raw));
        $defaultSeparator = null;
        $start = 0;
        if (str_starts_with($entries[0], 's,')) {
            $defaultSeparator = self::decodeSeparator($entries[0]);
            $start = 1;
        } elseif ($entries[0] !== '' && ! ctype_digit($entries[0][0])) {
            $defaultSeparator = self::decodeSeparator('s,'.self::escapeSeparatorValue($entries[0]));
            $start = 1;
        } elseif ($entries[0] === '') {
            $start = 1;
        }

        $indexToKind = array_flip($kindToIndex);
        $positionCounts = array_fill_keys(array_keys($kindToIndex), 0);
        $components = [];

        for ($i = $start, $count = count($entries); $i < $count; $i++) {
            $entry = $entries[$i];
            if ($entry === '') {
                continue;
            }
            if (str_starts_with($entry, 's,')) {
                $components[] = [
                    '@type' => $componentType,
                    'kind' => 'separator',
                    'value' => self::decodeSeparator($entry),
                ];

                continue;
            }

            $mainIndex = $entry;
            $subIndex = 0;
            if (str_contains($entry, ',')) {
                [$mainIndex, $subIndex] = array_map('intval', explode(',', $entry, 2));
            } else {
                $mainIndex = (int) $mainIndex;
            }

            $kind = $indexToKind[$mainIndex] ?? null;
            if ($kind === null) {
                continue;
            }

            $rawPart = (string) ($parts[$mainIndex] ?? '');
            $values = ConversionSupport::splitStructuredValues($rawPart);
            $value = (string) ($values[$subIndex] ?? '');
            if ($value === '') {
                continue;
            }

            $components[] = [
                '@type' => $componentType,
                'kind' => $kind,
                'value' => $value,
            ];
            $positionCounts[$kind] = ($positionCounts[$kind] ?? 0) + 1;
        }

        $result = [
            'components' => $components,
            'isOrdered' => true,
        ];
        if ($defaultSeparator !== null && $defaultSeparator !== '') {
            $result['defaultSeparator'] = $defaultSeparator;
        }

        return $result;
    }

    /**
     * @param  array<mixed>  $components
     * @return list<array{kind: string, value: string, '@type'?: string}>
     */
    public static function typedComponents(array $components): array
    {
        $typed = [];
        foreach ($components as $component) {
            if (! is_array($component)) {
                continue;
            }
            $kind = $component['kind'] ?? null;
            $value = $component['value'] ?? null;
            if ((! is_string($kind) && ! is_int($kind) && ! is_float($kind)) || (! is_string($value) && ! is_int($value) && ! is_float($value))) {
                continue;
            }
            $item = ['kind' => (string) $kind, 'value' => (string) $value];
            $type = $component['@type'] ?? null;
            if (is_string($type)) {
                $item['@type'] = $type;
            }
            $typed[] = $item;
        }

        return $typed;
    }

    private static function encodeSeparator(string $value): string
    {
        return 's,'.self::escapeSeparatorValue($value);
    }

    private static function escapeSeparatorValue(string $value): string
    {
        return str_replace(['\\', ',', ';'], ['\\\\', '\\,', '\\;'], $value);
    }

    private static function decodeSeparator(string $entry): string
    {
        $value = substr($entry, 2);

        return str_replace(['\\,', '\\;', '\\\\'], [',', ';', '\\'], $value);
    }
}
