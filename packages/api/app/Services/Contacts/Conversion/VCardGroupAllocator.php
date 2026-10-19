<?php

declare(strict_types=1);

namespace App\Services\Contacts\Conversion;

/**
 * Hands out `itemN` vCard groups for Apple X-ABLabel entries that no group on
 * the card uses yet. vCard groups are case-insensitive, so a client's `ITEM1`
 * and a new `item1` collide (CT-2, #1420).
 */
final class VCardGroupAllocator
{
    private int $counter = 0;

    /** @param array<string, true> $reserved Lowercase groups already on the card. */
    private function __construct(private array $reserved) {}

    /** @param array<mixed> $card */
    public static function forCard(array $card): self
    {
        return new self(self::groupsIn($card));
    }

    public function next(): string
    {
        do {
            $candidate = 'item'.(++$this->counter);
        } while (isset($this->reserved[$candidate]));
        $this->reserved[$candidate] = true;

        return $candidate;
    }

    /**
     * @param  array<mixed>  $node
     * @return array<string, true>
     */
    private static function groupsIn(array $node): array
    {
        $groups = [];
        foreach ($node as $key => $value) {
            if ($key === 'vCardParams' && is_array($value) && isset($value['group']) && is_string($value['group'])) {
                $groups[strtolower($value['group'])] = true;
            }
            if ($key === 'vCardProps' && is_array($value)) {
                foreach ($value as $tuple) {
                    if (is_array($tuple) && isset($tuple[1]['group']) && is_string($tuple[1]['group'])) {
                        $groups[strtolower($tuple[1]['group'])] = true;
                    }
                }
            }
            if (is_array($value)) {
                $groups += self::groupsIn($value);
            }
        }

        return $groups;
    }
}
