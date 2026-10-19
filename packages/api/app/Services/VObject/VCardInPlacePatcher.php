<?php

declare(strict_types=1);

namespace App\Services\VObject;

use Sabre\VObject\Component\VCard;
use Sabre\VObject\Property;
use Sabre\VObject\Reader;

/**
 * Applies a WGW contact edit to the stored vCard without rebuilding it.
 *
 * The writer renders the card twice: `baseline` from the contact as it was
 * read, and `generated` from the edited contact. Entries are matched by name and
 * PROP-ID (or, without a PROP-ID, by name as a whole). An entry whose baseline
 * and generated renderings are equal was not touched by the edit, so the stored
 * line stays as written, with its group and Apple `itemN.X-ABLabel` (#1418).
 * Changed entries keep their stored group; new entries get a group name that
 * does not collide with the stored ones.
 */
final class VCardInPlacePatcher
{
    public static function patch(string $stored, string $baseline, string $generated): string
    {
        $storedCard = Reader::read($stored);
        $baselineCard = Reader::read($baseline);
        $generatedCard = Reader::read($generated);
        if (! $storedCard instanceof VCard || ! $baselineCard instanceof VCard || ! $generatedCard instanceof VCard) {
            return $generated;
        }

        $storedEntries = self::entries($storedCard);
        $baselineEntries = self::entries($baselineCard);
        $generatedEntries = self::entries($generatedCard);
        $usedGroups = self::groups($storedCard);

        foreach (array_keys($baselineEntries + $generatedEntries) as $key) {
            $baselineRender = isset($baselineEntries[$key]) ? self::renderEntry($baselineEntries[$key]) : null;
            $generatedRender = isset($generatedEntries[$key]) ? self::renderEntry($generatedEntries[$key]) : null;
            if ($baselineRender === $generatedRender) {
                continue;
            }

            $storedEntry = $storedEntries[$key] ?? (isset($baselineEntries[$key])
                ? self::matchWithoutPropId($storedEntries, $baselineEntries[$key])
                : null);
            $keepGroup = $storedEntry !== null ? self::entryGroup($storedEntry) : null;
            if ($storedEntry !== null) {
                self::removeEntry($storedCard, $storedEntry);
            }
            if (! isset($generatedEntries[$key])) {
                continue;
            }

            $group = $keepGroup;
            if ($group === null && self::entryGroup($generatedEntries[$key]) !== null) {
                $group = self::freshGroup($usedGroups);
            }
            foreach (self::entryProperties($generatedEntries[$key]) as $property) {
                $copy = clone $property;
                $copy->group = $group;
                unset($copy['GROUP']);
                $storedCard->add($copy);
            }
        }

        return $storedCard->serialize();
    }

    /**
     * An entry is one property plus the X-AB* satellites that share its group.
     * Groups match case-sensitively: the writer keeps a stored `ITEM1` and adds
     * its own `item1`, and those belong to different entries.
     *
     * @return array<string, array{main: list<Property>, satellites: list<Property>}>
     */
    private static function entries(VCard $card): array
    {
        $satellitesByGroup = [];
        foreach ($card->children() as $child) {
            if ($child instanceof Property && self::isSatellite($child)) {
                $satellitesByGroup[(string) $child->group][] = $child;
            }
        }

        $entries = [];
        foreach ($card->children() as $child) {
            if (! $child instanceof Property || self::isSatellite($child)) {
                continue;
            }
            $propId = isset($child['PROP-ID']) ? (string) $child['PROP-ID'] : '';
            $key = $child->name.'|'.$propId;
            $entries[$key] ??= ['main' => [], 'satellites' => []];
            $entries[$key]['main'][] = $child;
            $group = $child->group !== null && $child->group !== '' ? $child->group : null;
            if ($group !== null && isset($satellitesByGroup[$group])) {
                array_push($entries[$key]['satellites'], ...$satellitesByGroup[$group]);
                unset($satellitesByGroup[$group]);
            }
        }

        return $entries;
    }

    /**
     * A stored card without PROP-IDs (written before PROP-IDs were added) is
     * matched on content, so a changed entry replaces it instead of duplicating.
     *
     * @param  array<string, array{main: list<Property>, satellites: list<Property>}>  $storedEntries
     * @param  array{main: list<Property>, satellites: list<Property>}  $baselineEntry
     * @return array{main: list<Property>, satellites: list<Property>}|null
     */
    private static function matchWithoutPropId(array $storedEntries, array $baselineEntry): ?array
    {
        // Labels are left out: the writer adds standard ones (Home, Work) that
        // the stored line never had.
        // Without PROP-IDs, all stored lines of a name share one entry, so each
        // line is compared on its own, by name and value: the writer normalizes
        // parameters (it drops TYPE=INTERNET, adds standard labels), so the
        // rendered lines rarely match the stored ones.
        $wanted = $baselineEntry['main'][0] ?? null;
        if (! $wanted instanceof Property) {
            return null;
        }
        $wantedValue = strtolower(trim($wanted->getRawMimeDirValue()));
        foreach ($storedEntries as $entry) {
            foreach ($entry['main'] as $property) {
                if ($property->name !== $wanted->name || strtolower(trim($property->getRawMimeDirValue())) !== $wantedValue) {
                    continue;
                }

                return ['main' => [$property], 'satellites' => array_values(array_filter(
                    $entry['satellites'],
                    static fn (Property $satellite): bool => $property->group !== null && $property->group !== ''
                        && strcasecmp((string) $satellite->group, (string) $property->group) === 0,
                ))];
            }
        }

        return null;
    }

    private static function isSatellite(Property $property): bool
    {
        return $property->group !== null && $property->group !== '' && str_starts_with($property->name, 'X-AB');
    }

    /**
     * @param  array{main: list<Property>, satellites: list<Property>}  $entry
     */
    private static function renderEntry(array $entry, bool $withPropId = true, bool $withSatellites = true): string
    {
        $lines = [];
        foreach ($withSatellites ? self::entryProperties($entry) : $entry['main'] as $property) {
            $params = [];
            foreach ($property->parameters() as $name => $parameter) {
                if ($name === 'GROUP' || (! $withPropId && $name === 'PROP-ID')) {
                    continue;
                }
                $params[] = $name.'='.implode(',', (array) $parameter->getParts());
            }
            sort($params);
            $lines[] = $property->name.';'.implode(';', $params).':'.$property->getRawMimeDirValue();
        }
        sort($lines);

        return implode("\n", $lines);
    }

    /**
     * @param  array{main: list<Property>, satellites: list<Property>}  $entry
     * @return list<Property>
     */
    private static function entryProperties(array $entry): array
    {
        return [...$entry['main'], ...$entry['satellites']];
    }

    /**
     * @param  array{main: list<Property>, satellites: list<Property>}  $entry
     */
    private static function entryGroup(array $entry): ?string
    {
        foreach ($entry['main'] as $property) {
            if ($property->group !== null && $property->group !== '') {
                return $property->group;
            }
        }

        return null;
    }

    /**
     * @param  array{main: list<Property>, satellites: list<Property>}  $entry
     */
    private static function removeEntry(VCard $card, array $entry): void
    {
        foreach (self::entryProperties($entry) as $property) {
            $card->remove($property);
        }
    }

    /**
     * @return array<string, true>
     */
    private static function groups(VCard $card): array
    {
        $groups = [];
        foreach ($card->children() as $child) {
            if ($child instanceof Property && $child->group !== null && $child->group !== '') {
                $groups[strtolower($child->group)] = true;
            }
        }

        return $groups;
    }

    /**
     * @param  array<string, true>  $used
     */
    private static function freshGroup(array &$used): string
    {
        for ($n = 1; ; $n++) {
            $candidate = 'item'.$n;
            if (! isset($used[$candidate])) {
                $used[$candidate] = true;

                return $candidate;
            }
        }
    }
}
