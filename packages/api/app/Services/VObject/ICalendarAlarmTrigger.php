<?php

declare(strict_types=1);

namespace App\Services\VObject;

use Sabre\VObject\Component;

/**
 * VALARM TRIGGER parse/write shared by Event (RelativeAlert) and Task (OffsetTrigger).
 */
final class ICalendarAlarmTrigger
{
    /**
     * @return array{kind: 'offset', offset: string, relatedTo: 'start'|'end'}|array{kind: 'absolute', when: string}|null
     */
    public static function fromValarm(Component $valarm): ?array
    {
        if (! isset($valarm->TRIGGER)) {
            return null;
        }

        $trigger = $valarm->TRIGGER;
        $triggerValue = trim((string) $trigger->getValue());
        if ($triggerValue === '') {
            return null;
        }

        $isDateTime = isset($trigger['VALUE'])
            && strtoupper((string) $trigger['VALUE']) === 'DATE-TIME';
        if ($isDateTime || preg_match('/^\d{8}T\d{6}Z?$/', $triggerValue) === 1) {
            return [
                'kind' => 'absolute',
                'when' => ICalendarDateTime::toJmap($triggerValue),
            ];
        }

        $relatedTo = isset($trigger['RELATED'])
            && strtoupper((string) $trigger['RELATED']) === 'END'
            ? 'end'
            : 'start';

        return [
            'kind' => 'offset',
            'offset' => $triggerValue,
            'relatedTo' => $relatedTo,
        ];
    }

    /**
     * Accepts Event RelativeAlert/AbsoluteAlert and Task OffsetTrigger/AbsoluteTrigger.
     *
     * @param  array<string, mixed>  $trigger
     * @return array{value: string, params: array<string, string>}|null
     */
    public static function toIcsParts(array $trigger): ?array
    {
        $type = $trigger['@type'] ?? '';

        if ($type === 'AbsoluteAlert' || $type === 'AbsoluteTrigger' || isset($trigger['when'])) {
            $when = $trigger['when'] ?? null;
            if (! is_string($when) || trim($when) === '') {
                return null;
            }

            return [
                'value' => ICalendarDateTime::toIcs($when),
                'params' => ['VALUE' => 'DATE-TIME'],
            ];
        }

        if ($type === 'RelativeAlert' || $type === 'OffsetTrigger' || isset($trigger['offset'])) {
            $offset = $trigger['offset'] ?? null;
            if (! is_string($offset) || trim($offset) === '') {
                return null;
            }

            $params = [];
            $relatedTo = 'start';
            if (isset($trigger['relatedTo']) && is_string($trigger['relatedTo'])) {
                $relatedTo = strtolower($trigger['relatedTo']);
            } elseif (isset($trigger['relativeTo']) && is_string($trigger['relativeTo'])) {
                $relatedTo = strtolower($trigger['relativeTo']);
            }
            if ($relatedTo === 'end') {
                $params['RELATED'] = 'END';
            }

            return [
                'value' => $offset,
                'params' => $params,
            ];
        }

        return null;
    }
}
