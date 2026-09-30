<?php

declare(strict_types=1);

namespace App\Http\Requests\Api\V1\Concerns;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Narrows {@see FormRequest::validated()} after rules()
 * have already rejected caller input. A mismatch here is a bug in those rules.
 */
trait NarrowsValidatedInput
{
    private function requiredString(mixed $value): string
    {
        if (is_string($value) && $value !== '') {
            return $value;
        }

        throw new \LogicException('FormRequest rules did not produce a non-empty string.');
    }

    private function nullableString(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }
        if (is_string($value)) {
            return $value;
        }

        throw new \LogicException('FormRequest rules did not produce a string.');
    }

    private function requiredBool(mixed $value): bool
    {
        if (is_bool($value)) {
            return $value;
        }

        throw new \LogicException('FormRequest rules did not produce a boolean.');
    }

    private function nullableInt(mixed $value): ?int
    {
        if ($value === null) {
            return null;
        }
        if (is_int($value)) {
            return $value;
        }

        throw new \LogicException('FormRequest rules did not produce an integer.');
    }

    /**
     * @return list<string>
     */
    private function stringList(mixed $value): array
    {
        if (! is_array($value)) {
            return [];
        }

        $items = [];
        foreach ($value as $item) {
            if (is_string($item)) {
                $items[] = $item;
            }
        }

        return $items;
    }
}
