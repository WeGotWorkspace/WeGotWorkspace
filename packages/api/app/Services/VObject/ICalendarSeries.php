<?php

declare(strict_types=1);

namespace App\Services\VObject;

use Sabre\VObject\Component;

/**
 * Group VEVENT / VTODO components by UID and split master vs RECURRENCE-ID.
 */
final class ICalendarSeries
{
    /**
     * @param  list<Component>  $components
     * @param  (callable(Component, int): string)|null  $anonymousKey
     * @return array<string, list<Component>>
     */
    public static function groupByUid(array $components, ?callable $anonymousKey = null): array
    {
        $grouped = [];
        foreach ($components as $index => $component) {
            $uid = isset($component->UID) ? trim((string) $component->UID->getValue()) : '';
            $key = $uid !== ''
                ? $uid
                : ($anonymousKey !== null ? $anonymousKey($component, $index) : '__anonymous_'.$index);
            $grouped[$key][] = $component;
        }

        return $grouped;
    }

    /**
     * @param  list<Component>  $group
     * @return array{masters: list<Component>, overrides: list<Component>}
     */
    public static function partitionMastersAndOverrides(array $group): array
    {
        $masters = [];
        $overrides = [];
        foreach ($group as $component) {
            if (isset($component->{'RECURRENCE-ID'})) {
                $overrides[] = $component;

                continue;
            }
            $masters[] = $component;
        }

        return ['masters' => $masters, 'overrides' => $overrides];
    }
}
